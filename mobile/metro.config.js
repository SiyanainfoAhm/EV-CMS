const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
const previousResolveRequest = config.resolver.resolveRequest;

function isTslibModulesIndex(filePath) {
  return filePath.replace(/\\/g, "/").endsWith("tslib/modules/index.js");
}

function tslibEs6From(originDir) {
  const tslibMain = require.resolve("tslib", { paths: [originDir, __dirname] });
  return path.join(path.dirname(tslibMain), "tslib.es6.js");
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // pdf-lib's nested tslib ESM entry breaks under Metro (default export undefined).
  const origin = (context.originModulePath || "").replace(/\\/g, "/");
  const fromPdfLib = origin.includes("/pdf-lib/");
  const normalizedName = moduleName.replace(/\\/g, "/");

  if (
    fromPdfLib &&
    (normalizedName === "tslib" || normalizedName.includes("tslib/modules"))
  ) {
    return {
      type: "sourceFile",
      filePath: tslibEs6From(path.dirname(context.originModulePath)),
    };
  }

  const resolved = previousResolveRequest
    ? previousResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);

  if (
    fromPdfLib &&
    resolved?.type === "sourceFile" &&
    isTslibModulesIndex(resolved.filePath)
  ) {
    return {
      type: "sourceFile",
      filePath: path.join(path.dirname(resolved.filePath), "..", "tslib.es6.js"),
    };
  }

  return resolved;
};

// OneDrive + Windows: disable Watchman; limit workers for slower file systems.
if (process.platform === "win32") {
  config.watcher = {
    ...config.watcher,
    watchman: false,
  };
  config.maxWorkers = 2;
}

module.exports = config;
