// A require, not an import: importing a file outside src/ would move tsc's
// rootDir and with it every path under dist/. Same depth from src/ and dist/.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../../../package.json') as { version: string };

/** `0.1.0`, or `0.1.0+abc1234` on Heroku where the slug commit is known. */
export function appVersion(): string {
  const commit = process.env.HEROKU_SLUG_COMMIT ?? process.env.SOURCE_VERSION;
  return commit ? `${pkg.version}+${commit.slice(0, 7)}` : pkg.version;
}
