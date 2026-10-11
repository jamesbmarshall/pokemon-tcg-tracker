// PokéTracker demo instance on Azure Container Apps.
//
// A thin variant of containerapps.bicep for a public, read-only showcase: DEMO_MODE=1 is baked
// in, so the server seeds its own sample collection and a visitor signs in with a single click
// (no setup token, no real owner account ever exists). See apps/server/src/demo.ts for what
// DEMO_MODE actually restricts.
//
// Files only: this isn't wired into CI's bicep/json parity check and there is no "Deploy to
// Azure" button for it, because a demo is something the project maintainer deploys once and
// shares a link to, not something every fork needs. To deploy it yourself:
//
//   az deployment group create \
//     --resource-group <your-resource-group> \
//     --template-file deploy/azure/demo.bicep \
//     --parameters appName=poketracker-demo
//
// Then take the `url` output and put it behind the "Try the demo" link in README.md.

@description('Name for the app. It becomes part of the web address: https://<name>.<region-id>.azurecontainerapps.io')
@minLength(3)
@maxLength(24)
param appName string = 'poketracker-demo'

@description('Azure region. Defaults to the resource group\'s region.')
param location string = resourceGroup().location

@description('Container image. Leave as is unless you are testing a specific version.')
param image string = 'ghcr.io/jamesbmarshall/pokemon-tcg-tracker:latest'

@description('Only needed while the image is private: a GitHub username with access to it.')
param registryUsername string = ''

@description('Only needed while the image is private: a GitHub token with the read:packages scope.')
@secure()
param registryPassword string = ''

@description('IANA time zone used for scheduled jobs (including the nightly demo reset) and logs, e.g. Europe/London.')
param timeZone string = 'UTC'

// Storage account names must be globally unique, 3-24 lowercase letters and digits.
var suffix = uniqueString(resourceGroup().id, appName)
var storageName = take('pt${toLower(replace(appName, '-', ''))}${suffix}', 24)
var shareName = 'poketracker-demo-data'
var usePrivateRegistry = !empty(registryUsername) && !empty(registryPassword)

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${appName}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    // A demo instance has no data worth keeping long after the fact; 7 days is enough to debug
    // anything wrong with it.
    retentionInDays: 7
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
    // The demo re-seeds itself nightly and never grows real user data, so a small share is fine.
    shareQuota: 5
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
      secrets: usePrivateRegistry ? [
        { name: 'registry-password', value: registryPassword }
      ] : []
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
            { name: 'DEMO_MODE', value: '1' }
            { name: 'TZ', value: timeZone }
          ]
          volumeMounts: [{ volumeName: 'data', mountPath: '/data' }]
          probes: [
            // Generous start-up window: first boot also seeds the demo collection from TCGdex.
            { type: 'Startup', httpGet: { path: '/health', port: 3000 }, periodSeconds: 10, failureThreshold: 18 }
            { type: 'Liveness', httpGet: { path: '/health', port: 3000 }, periodSeconds: 30, failureThreshold: 3 }
          ]
        }
      ]
      // One replica, always on: SQLite allows a single writer, and the scheduler (including the
      // nightly demo reset) assumes it is the only copy. Scaling to zero would also pause it.
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

@description('Share this as the "Try the demo" link. Anyone who opens it can sign in with the demo button, read-only.')
output url string = 'https://${app.properties.configuration.ingress.fqdn}'
