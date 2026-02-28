const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Configure workspace packages resolution
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

// Watch all files in the monorepo
config.watchFolders = Array.from(new Set([...(config.watchFolders || []), workspaceRoot]));

// Resolve workspace packages
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Add react-dom shim for packages that require it (like @clerk/clerk-react)
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-dom': path.resolve(__dirname, 'shims/react-dom.js'),
  '@webl/shared': path.resolve(workspaceRoot, 'packages/shared'),
};

module.exports = withNativeWind(config, { input: './global.css' });
