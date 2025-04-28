export default defineNuxtConfig({
  devtools: { enabled: true },
  // Modules
  modules: [
    '@nuxt/ui',
    '@nuxt/image',
    '@nuxtjs/tailwindcss'  // Make sure this is included
  ],

  // Runtime config for environment variables
  runtimeConfig: {
    public: {
      apiBase: `http://localhost:5000`  // แก้เป็น port 5000
    }
  },

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.js',
    exposeConfig: false,
    viewer: true
  },

  // UI Configuration


  // App Configuration
  app: {
    head: {
      title: 'Admin Dashboard',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ]
    }
  },

  // CSS
  css: ['~/assets/css/main.css'],

  // PostCSS Configuration
  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {}
    }
  },

  // Build Configuration
  build: {
    transpile: ['@heroicons/vue']
  },

  // TypeScript
  typescript: {
    strict: true,
    typeCheck: false
  },

  nitro: {
    devProxy: {
      '/api': {
        target: `http://localhost:5000`, // แก้เป็น port 5000
        changeOrigin: true
      }
    }
  },

  compatibilityDate: '2025-04-26'
})