import type { RuntimeBinaryPlan, TemplateRecord } from '@contracts/index'

export type RuntimeCatalog = Record<TemplateRecord['engine'], RuntimeBinaryPlan>

const DEFAULT_SINGBOX_VERSION = '1.13.0'
const DEFAULT_XRAY_VERSION = '26.2.6'
const SINGBOX_RELEASE_BASE_URL = 'https://github.com/SagerNet/sing-box/releases/download'
const XRAY_RELEASE_BASE_URL = 'https://github.com/XTLS/Xray-core/releases/download'

export function buildRuntimeCatalog(input: {
  singBoxVersion?: string
  xrayVersion?: string
} = {}): RuntimeCatalog {
  const singBoxVersion = (input.singBoxVersion || DEFAULT_SINGBOX_VERSION).trim()
  const xrayVersion = (input.xrayVersion || DEFAULT_XRAY_VERSION).trim()

  return {
    'sing-box': {
      engine: 'sing-box',
      version: singBoxVersion,
      binaryName: 'sing-box',
      installPath: '/usr/local/bin/sing-box',
      archiveFormat: 'tar.gz',
      downloadBaseUrl: `${SINGBOX_RELEASE_BASE_URL}/v${singBoxVersion}`,
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
      downloadBaseUrl: `${XRAY_RELEASE_BASE_URL}/v${xrayVersion}`,
      assetNameTemplate: 'Xray-linux-{arch}.zip',
      binaryPathTemplate: 'xray',
      runArgsTemplate: 'run -config {config_path}',
    },
  }
}
