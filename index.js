// @ts-check

const path = require('path')
const fs = require('fs/promises')

// if client is bundled this gets its output path
const prismaPathRegex = /"?output"?:\s*{\s*"?value"?:\s*"(.*?)",\s*"?fromEnvVar"?/g

function getPrismaPath(from) {
  try {
    return path.dirname(require.resolve('.prisma/client', { paths: [from] }))
  } catch (e) {}

  return from
}

// get all required prisma files (schema + engine)
async function getPrismaFiles(from) {
  const prismaPath = getPrismaPath(from)
  const filterRegex = /schema\.prisma|.*?engine.*?/
  const prismaFiles = await fs.readdir(prismaPath)

  return prismaFiles.filter(file => file.match(filterRegex))
}

class PrismaPlugin {
  constructor(options = {}) {
    this.options = options
  }

  /**
   * @param {import('webpack').Compiler} compiler 
   */
  apply(compiler) {
    const { webpack } = compiler;
    const { Compilation, sources } = webpack;

    const fromDestPrismaMap = [] // [from, dest][]

    // read bundles to find which prisma files to copy (for all users)
    compiler.hooks.compilation.tap('PrismaPlugin', (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: 'PrismaPlugin',
          stage: Compilation.PROCESS_ASSETS_STAGE_ANALYSE,
        },
        async (assets) => {
          const jsAssetNames = Object.keys(assets).filter((k) => k.endsWith('.js'))

          const jsAsyncActions = jsAssetNames.map(async (assetName) => {
            const oldSourceAsset = compilation.getAsset(assetName)
            const oldSourceContents = oldSourceAsset.source.source() + ''

            for (const match of oldSourceContents.matchAll(prismaPathRegex)) {
              const prismaPath = getPrismaPath(match[1])
              const prismaFiles = await getPrismaFiles(match[1])

              const fromDestFileMap = prismaFiles.map((f) => [
                path.join(prismaPath, f), // from
                path.join(compiler.outputPath, f) // dest
              ])

              fromDestPrismaMap.push(...fromDestFileMap)
            }
          })

          await Promise.all(jsAsyncActions)
        }
      );
    });

    // update nft.json files to include prisma files (only for vercel)
    compiler.hooks.compilation.tap('PrismaPlugin', (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: 'PrismaPlugin',
          stage: Compilation.PROCESS_ASSETS_STAGE_ANALYSE,
        },
        async (assets) => {
          const nftAssetNames = Object.keys(assets).filter((k) => k.endsWith('.nft.json'))

          const nftAsyncActions = nftAssetNames.map(async (assetName) => {
            // paths
            const outputPath = compiler.outputPath
            const assetPath = path.resolve(outputPath, assetName)
            const assetDir = path.dirname(assetPath)

            // data
            const oldSourceAsset = compilation.getAsset(assetName)
            const oldSourceContents = oldSourceAsset.source.source() + ''
            const ntfLoadedAsJson = JSON.parse(oldSourceContents)

            // update
            fromDestPrismaMap.forEach(([from, dest]) => {
              ntfLoadedAsJson.files.push(path.relative(assetDir, dest))
            })

            // persist
            const newSourceString = JSON.stringify(ntfLoadedAsJson)
            const newRawSource = new sources.RawSource(newSourceString)
            compilation.updateAsset(assetName, newRawSource);
          })

          await Promise.all(nftAsyncActions)
        }
      );
    });

    // copy prisma files to output as the final step (for all users)
    compiler.hooks.done.tapPromise(
      'PrismaPlugin',
      async () => {
        await Promise.all(fromDestPrismaMap.map(([from, dest]) => fs.copyFile(from, dest)))
      }
    );
  }
}

module.exports = { PrismaPlugin }