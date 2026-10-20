@minLength(3)
@maxLength(24)
param appName string = 'poketracker'
param location string = resourceGroup().location
@description('Published application image pinned by sha256 digest, including launcher 1.1 or newer.')
param image string
@description('SSH public key; password authentication is disabled.')
param sshPublicKey string
@description('Administrator source CIDR for SSH. Do not use an unrestricted internet range.')
param sshSourceCidr string
param adminUsername string = 'poketracker'
param vmSize string = 'Standard_B2s'
@minValue(32)
param dataDiskGiB int = 64

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${appName}-nsg'
  location: location
  properties: {
    securityRules: [
      { name: 'https', properties: { priority: 100, access: 'Allow', direction: 'Inbound', protocol: 'Tcp', sourceAddressPrefix: '*', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '443' } }
      { name: 'acme-http', properties: { priority: 110, access: 'Allow', direction: 'Inbound', protocol: 'Tcp', sourceAddressPrefix: '*', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '80' } }
      { name: 'admin-ssh', properties: { priority: 120, access: 'Allow', direction: 'Inbound', protocol: 'Tcp', sourceAddressPrefix: sshSourceCidr, sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '22' } }
    ]
  }
}
resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${appName}-network'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.43.0.0/16'] }
    subnets: [{ name: 'app', properties: { addressPrefix: '10.43.1.0/24', networkSecurityGroup: { id: nsg.id } } }]
  }
}
resource ip 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${appName}-ip'
  location: location
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static', dnsSettings: { domainNameLabel: '${appName}-${uniqueString(resourceGroup().id)}' } }
}
resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${appName}-nic'
  location: location
  properties: { ipConfigurations: [{ name: 'app', properties: { privateIPAllocationMethod: 'Dynamic', publicIPAddress: { id: ip.id }, subnet: { id: '${network.id}/subnets/app' } } }] }
}
resource disk 'Microsoft.Compute/disks@2024-03-02' = {
  name: '${appName}-data'
  location: location
  sku: { name: 'StandardSSD_LRS' }
  properties: { creationData: { createOption: 'Empty' }, diskSizeGB: dataDiskGiB }
}
var init = replace(replace(loadTextContent('vm-cloud-init.yaml'), '__IMAGE_B64__', base64(image)), '__DOMAIN_B64__', base64(ip.properties.dnsSettings.fqdn))
resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: appName
  location: location
  properties: {
    hardwareProfile: { vmSize: vmSize }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: 'ubuntu-24_04-lts', sku: 'server', version: 'latest' }
      osDisk: { createOption: 'FromImage', managedDisk: { storageAccountType: 'StandardSSD_LRS' }, deleteOption: 'Delete' }
      dataDisks: [{ lun: 0, name: disk.name, createOption: 'Attach', managedDisk: { id: disk.id }, caching: 'None', deleteOption: 'Detach' }]
    }
    osProfile: {
      computerName: appName
      adminUsername: adminUsername
      customData: base64(init)
      linuxConfiguration: { disablePasswordAuthentication: true, ssh: { publicKeys: [{ path: '/home/${adminUsername}/.ssh/authorized_keys', keyData: sshPublicKey }] } }
    }
    networkProfile: { networkInterfaces: [{ id: nic.id }] }
    diagnosticsProfile: { bootDiagnostics: { enabled: true } }
  }
}
output url string = 'https://${ip.properties.dnsSettings.fqdn}'
output dataDiskResourceId string = disk.id
output vmResourceId string = vm.id
