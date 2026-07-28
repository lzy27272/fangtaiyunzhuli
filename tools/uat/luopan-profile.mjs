import path from 'node:path'

const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/

export const luopanProfileName = ({
  argv = process.argv,
  env = process.env,
} = {}) => {
  const argument = argv.find((value) => value.startsWith('--profile='))
  const value = (
    argument?.slice('--profile='.length)
    || env.LUOPAN_DISCOVERY_PROFILE
    || 'default'
  ).trim().toLowerCase()
  if (!PROFILE_PATTERN.test(value)) {
    throw new Error('LUOPAN_PROFILE_NAME_INVALID')
  }
  return value
}

export const luopanProfilePaths = ({
  repoRoot,
  profileName,
}) => {
  const baseRuntimeRoot = path.join(
    repoRoot,
    '.uat-runtime',
    'luopan-discovery',
  )
  const runtimeRoot = profileName === 'default'
    ? baseRuntimeRoot
    : path.join(baseRuntimeRoot, 'profiles', profileName)
  return {
    baseRuntimeRoot,
    runtimeRoot,
    profileRoot: path.join(runtimeRoot, 'browser-profile'),
  }
}
