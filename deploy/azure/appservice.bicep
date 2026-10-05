// PokéTracker on Azure App Service (Linux, custom container).
//
// Creates: a Linux App Service plan (B1 by default) and a web app running the PokéTracker image,
// with HTTPS on its *.azurewebsites.net address and /data kept on App Service's persistent /home
// share.
//
// /home is a network share, so SQLite runs in rollback-journal mode rather than WAL. The plan is
// pinned to one instance: SQLite allows a single writer, and the scheduler and updater assume
// they're the only copy running. Don't scale out.
//
// Build the portal template with: az bicep build -f appservice.bicep --outfile appservice.json

@description('Globally unique name for the app. It becomes the web address: https://<name>.azurewebsites.net')
@minLength(2)
@maxLength(60)
param appName string

@description('Azure region. Defaults to the resource group\'s region.')
param location string = resourceGroup().location

@description('A secret phrase you choose now and type in when you first open the app, to create the owner account. It stops anyone else from claiming a freshly deployed instance. At least 12 characters.')
@secure()
@minLength(12)
param setupToken string

@description('App Service plan size. B1 is plenty for a household; "Always On" keeps the background jobs running, so the Free tier is not offered.')
@allowed(['B1', 'B2', 'S1', 'P0v3', 'P1v3'])
param sku string = 'B1'

@description('Container image. Leave as is unless you are testing a specific version.')
param image string = 'ghcr.io/jamesbmarshall/pokemon-tcg-tracker:latest'

@description('Only needed while the image is private: a GitHub username with access to it.')
param registryUsername string = ''

@description('Only needed while the image is private: a GitHub token with the read:packages scope.')
@secure()
param registryPassword string = ''

@description('IANA time zone used for scheduled jobs and logs, e.g. Europe/London.')
param timeZone string = 'UTC'

var usePrivateRegistry = !empty(registryUsername) && !empty(registryPassword)

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan'
  location: location
  kind: 'linux'
  sku: { name: sku, capacity: 1 }
  properties: { reserved: true }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux,container'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'DOCKER|${image}'
      alwaysOn: true
      http20Enabled: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: '/health'
      appSettings: concat([
        // Keep /home (and so /home/poketracker) across restarts and redeploys.
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'true' }
        { name: 'WEBSITES_PORT', value: '3000' }
        // First boot can take a while (migrations, backups); don't let App Service give up early.
        { name: 'WEBSITES_CONTAINER_START_TIME_LIMIT', value: '600' }
        { name: 'DATA_DIR', value: '/home/poketracker' }
        { name: 'PUBLIC_URL', value: 'https://${appName}.azurewebsites.net' }
        { name: 'TRUST_PROXY', value: '1' }
        { name: 'SQLITE_JOURNAL_MODE', value: 'delete' }
        { name: 'SETUP_TOKEN', value: setupToken }
        { name: 'TZ', value: timeZone }
      ], usePrivateRegistry ? [
        { name: 'DOCKER_REGISTRY_SERVER_URL', value: 'https://ghcr.io' }
        { name: 'DOCKER_REGISTRY_SERVER_USERNAME', value: registryUsername }
        { name: 'DOCKER_REGISTRY_SERVER_PASSWORD', value: registryPassword }
      ] : [])
    }
  }
}

@description('Open this address and enter your setup token to create the owner account.')
output url string = 'https://${site.properties.defaultHostName}'
