// @ts-check

const path = require('path')
const fs = require('fs/promises')

// if client is bundled this gets its output path
// regex works both on escaped and non-escaped code
const prismaDirRegex = /\\?"?output\\?"?:\s*{(?:\\n?|\s)*\\?"?value\\?"?:(?:\\n?|\s)*\\?"(.*?)\\?",(?:\\n?|\s)*\\?"?fromEnvVar\\?"?/g

function getPrismaDir(from) {
  try {
    return path.dirname(require.resolve('.prisma/client', { paths: [from] }))
  } catch (e) {}

  return from
}

// get all required prisma files (schema + engine)
async function getPrismaFiles(from) {
  const prismaDir = getPrismaDir(from)
  const filterRegex = /schema\.prisma|.*?engine.*?/
  const prismaFiles = await fs.readdir(prismaDir)

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
            // prepare paths
            const outputDir = compiler.outputPath
            const assetPath = path.resolve(outputDir, assetName)
            const assetDir = path.dirname(assetPath)

            // get sources
            const sourceAsset = compilation.getAsset(assetName)
            const sourceContents = sourceAsset.source.source() + ''

            // update files to copy
            for (const match of sourceContents.matchAll(prismaDirRegex)) {
              const prismaDir = getPrismaDir(match[1])
              const prismaFiles = await getPrismaFiles(match[1])

              const fromDestFileMap = prismaFiles.map((f) => [
                path.join(prismaDir, f), // from
                path.join(assetDir, f) // dest
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
            // prepare paths
            const outputDir = compiler.outputPath
            const assetPath = path.resolve(outputDir, assetName)
            const assetDir = path.dirname(assetPath)

            // get sources
            const oldSourceAsset = compilation.getAsset(assetName)
            const oldSourceContents = oldSourceAsset.source.source() + ''
            const ntfLoadedAsJson = JSON.parse(oldSourceContents)

            // update sources
            fromDestPrismaMap.forEach(([from, dest]) => {
              ntfLoadedAsJson.files.push(path.relative(assetDir, dest))
            })

            // persist sources
            const newSourceString = JSON.stringify(ntfLoadedAsJson)
            const newRawSource = new sources.RawSource(newSourceString)
            compilation.updateAsset(assetName, newRawSource);
          })

          await Promise.all(nftAsyncActions)
        }
      );
    });

    // copy prisma files to output as the final step (for all users)
    compiler.hooks.done.tapPromise('PrismaPlugin', async () => {
      const asyncActions = fromDestPrismaMap.map(async ([from, dest]) => {
        // only copy if file doesn't exist, necessary for watch mode
        if (await fs.access(dest).catch(() => false) === false) {
          return fs.copyFile(from, dest)
        }
      })

      await Promise.all(asyncActions)
    });
  }
}

module.exports = { PrismaPlugin }