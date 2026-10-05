// PokéTracker on Azure Container Apps.
//
// Creates: a Log Analytics workspace, a storage account with an Azure Files share for /data, a
// Container Apps environment and the app itself, with HTTPS on its *.azurecontainerapps.io address.
//
// SQLite and Azure Files: SMB shares don't support the byte-range locks SQLite normally relies on.
// So the share is mounted with `nobrl` (locks are handled locally) and SQLite runs in rollback-
// journal mode instead of WAL. That's safe only because exactly one replica ever runs. Never
// raise maxReplicas: two copies writing to the same database file would corrupt it.
//
// Build the portal template with: az bicep build -f containerapps.bicep --outfile containerapps.json

@description('Name for the app. It becomes part of the web address: https://<name>.<region-id>.azurecontainerapps.io')
@minLength(3)
@maxLength(24)
param appName string = 'poketracker'

@description('Azure region. Defaults to the resource group\'s region.')
param location string = resourceGroup().location

@description('A secret phrase you choose now and type in when you first open the app, to create the owner account. It stops anyone else from claiming a freshly deployed instance. At least 12 characters.')
@secure()
@minLength(12)
param setupToken string

@description('Container image. Leave as is unless you are testing a specific version.')
param image string = 'ghcr.io/jamesbmarshall/pokemon-tcg-tracker:latest'

@description('Only needed while the image is private: a GitHub username with access to it.')
param registryUsername string = ''

@description('Only needed while the image is private: a GitHub token with the read:packages scope.')
@secure()
param registryPassword string = ''

@description('IANA time zone used for scheduled jobs and logs, e.g. Europe/London.')
param timeZone string = 'UTC'

// Storage account names must be globally unique, 3-24 lowercase letters and digits.
var suffix = uniqueString(resourceGroup().id, appName)
var storageName = take('pt${toLower(replace(appName, '-', ''))}${suffix}', 24)
var shareName = 'poketracker-data'
var usePrivateRegistry = !empty(registryUsername) && !empty(registryPassword)

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${appName}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}

resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  name: '${storage.name}/default/${shareName}'
  properties: {
    shareQuota: 20
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${appName}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource envStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: env
  name: 'data'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: shareName
      accessMode: 'ReadWrite'
    }
  }
  dependsOn: [share]
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      secrets: concat([
        { name: 'setup-token', value: setupToken }
      ], usePrivateRegistry ? [
        { name: 'registry-password', value: registryPassword }
      ] : [])
      registries: usePrivateRegistry ? [
        { server: 'ghcr.io', username: registryUsername, passwordSecretRef: 'registry-password' }
      ] : []
    }
    template: {
      containers: [
        {
          name: 'poketracker'
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'PUBLIC_URL', value: 'https://${appName}.${env.properties.defaultDomain}' }
            { name: 'TRUST_PROXY', value: '1' }
            { name: 'SQLITE_JOURNAL_MODE', value: 'delete' }
            { name: 'SETUP_TOKEN', secretRef: 'setup-token' }
            { name: 'TZ', value: timeZone }
          ]
          volumeMounts: [{ volumeName: 'data', mountPath: '/data' }]
          probes: [
            // Generous start-up window: the first boot runs migrations and may restore a backup.
            { type: 'Startup', httpGet: { path: '/health', port: 3000 }, periodSeconds: 10, failureThreshold: 18 }
            { type: 'Liveness', httpGet: { path: '/health', port: 3000 }, periodSeconds: 30, failureThreshold: 3 }
          ]
        }
      ]
      // One replica, always on: SQLite allows a single writer, and the scheduler and updater
      // assume they are the only copy. Scaling to zero would also pause the background jobs.
      scale: { minReplicas: 1, maxReplicas: 1 }
      volumes: [
        {
          name: 'data'
          storageType: 'AzureFile'
          storageName: envStorage.name
          // nobrl: SQLite's locks stay in-process (safe with one replica). uid/gid 1000 is the
          // image's non-root "node" user, so it can write to the share.
          mountOptions: 'nobrl,mfsymlinks,cache=strict,uid=1000,gid=1000,dir_mode=0750,file_mode=0640'
        }
      ]
    }
  }
}

@description('Open this address and enter your setup token to create the owner account.')
output url string = 'https://${app.properties.configuration.ingress.fqdn}'
