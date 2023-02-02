# Experimental Prisma Webpack Plugin

Ensures that your Prisma files are copied

## Next.js

```js
module.exports = {
  output: 'standalone',
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.plugins = [...config.plugins, new PrismaPlugin()]
    }

    return config
  },
}
```

## Webpack

```js
module.exports = {
  plugins: [new PrismaPlugin()]
}
```