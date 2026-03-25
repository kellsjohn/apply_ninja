module.exports = {
  singleQuote: true,
  trailingComma: "all",
  removeTrailingWhitespace: true,
  arrowParens: "always",
  semi: true,
  printWidth: 300,
  tabWidth: 2,
  endOfLine: "auto",
  pugSortAttributes: "desc",
  pugEmptyAttributes: "none",
  pugClassNotation: "attribute",
  pugBracketSpacing: true,
  pugSingleQuote: false,
  pugIdNotation: "as-is",
  plugins: ["@prettier/plugin-pug"],
  "pugFramework": "vue"
};
