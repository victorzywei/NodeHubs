import type { RuntimeBinaryPlan, TemplateRecord } from '@contracts/index'

export type RuntimeCatalog = Record<TemplateRecord['engine'], RuntimeBinaryPlan>

const DEFAULT_SINGBOX_VERSION = '1.13.0'
const DEFAULT_XRAY_VERSION = '26.2.6'

export function buildRuntimeCatalog(input: {
  singBoxVersion?: string
  xrayVersion?: string
  singBoxReleaseBaseUrl?: string
  xrayReleaseBaseUrl?: string
} = {}): RuntimeCatalog {
  const singBoxVersion = (input.singBoxVersion || DEFAULT_SINGBOX_VERSION).trim()
  const xrayVersion = (input.xrayVersion || DEFAULT_XRAY_VERSION).trim()
  const singBoxReleaseBaseUrl = (input.singBoxReleaseBaseUrl || 'https://github.com/SagerNet/sing-box/releases/download').replace(/\/+$/, '')
  const xrayReleaseBaseUrl = (input.xrayReleaseBaseUrl || 'https://github.com/XTLS/Xray-core/releases/download').replace(/\/+$/, '')

  return {
    'sing-box': {
      engine: 'sing-box',
      version: singBoxVersion,
      binaryName: 'sing-box',
      installPath: '/usr/local/bin/sing-box',
      archiveFormat: 'tar.gz',
      downloadBaseUrl: `${singBoxReleaseBaseUrl}/v${singBoxVersion}`,
      assetNameTemplate: `sing-box-${singBoxVersion}-linux-{arch}.tar.gz`,
      binaryPathTemplate: `sing-box-${singBoxVersion}-linux-{arch}/sing-box`,
      runArgsTemplate: 'run -c {config_path}',
    },
    xray: {
      engine: 'xray',
      version: xrayVersion,
      binaryName: 'xray',
      installPath: '/usr/local/bin/xray',
      archiveFormat: 'zip',
      downloadBaseUrl: `${xrayReleaseBaseUrl}/v${xrayVersion}`,
      assetNameTemplate: 'Xray-linux-{arch}.zip',
      binaryPathTemplate: 'xray',
      runArgsTemplate: 'run -config {config_path}',
    },
  }
}
