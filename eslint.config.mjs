// Deliberately narrow. The point of linting here is to catch the class of bug
// that shipped in 0.1.0: a function referenced but never defined, which no
// test can see because the tests never load the service worker. Style is not
// the target -- the existing code is consistent and is left alone.
export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        chrome: 'readonly',
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextDecoder: 'readonly',
        MutationObserver: 'readonly',
        DOMParser: 'readonly',
        CustomEvent: 'readonly',
        DataTransfer: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        getComputedStyle: 'readonly',
        structuredClone: 'readonly',
        AbortController: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        crypto: 'readonly',
        performance: 'readonly',
        history: 'readonly',
        Blob: 'readonly',
        ClipboardEvent: 'readonly',
        ZhihuPaper: 'writable'
      }
    },
    rules: {
      'no-undef': 'error',
      // ZhihuPaper is extract.js's export surface: assigned there, read by badge.js.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^ZhihuPaper$' }]
    }
  },
  {
    // Content scripts are classic scripts, not modules.
    files: ['src/content/*.js'],
    languageOptions: { sourceType: 'script' }
  },
  {
    ignores: ['node_modules/**', 'tests/**', 'data/**']
  }
];
