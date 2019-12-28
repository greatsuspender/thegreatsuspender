module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  env: {
    browser: true,
    es6: true,
    webextensions: true,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier/@typescript-eslint',
    'plugin:prettier/recommended',
  ],
  overrides: [
    {
      files: ['*.js'],
      rules: {
        'require-atomic-updates': 'warn',
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/no-use-before-define': 'off',
        // '@typescript-eslint/no-floating-promises': 'off',
      },
    },
  ],
  rules: {
    // 'no-const-assign': 'error',
    // 'no-console': 'warn',
    // 'require-await': 'error',
    // // '@typescript-eslint/prefer-interface': 'off',
    // '@typescript-eslint/no-floating-promises': 'error',
    // // '@typescript-eslint/strict-boolean-expressions': ['error', { ignoreRhs: true, allowNullable: true }],
    // 'no-unused-vars': [
    //   'error',
    //   { vars: 'all', args: 'none', ignoreRestSiblings: false },
    // ],
    // 'no-undef': ['error'],
    // 'no-proto': ['error'],
    // //        "prefer-arrow-callback": ["warn"],  TODO: refactor to use arrow functions
    // //        "no-var": ["error"],  TODO: refactor to use let and const
    // 'prefer-spread': ['warn'],
    // //    "semi": ["error", "always"],
    // 'padded-blocks': ['off', { blocks: 'never' }],
    // //    "indent": ["error", 2],
    'one-var': ['error', 'never'],
    // 'spaced-comment': ['off', 'always'],
  },
  settings: {
    eslint: {
      packageManager: 'yarn',
    },
    react: {
      version: 'detect',
    },
  },
};
