// Unit tests import src/*.ts directly (Node strips the types). Those modules import each other without an
// extension, as Vite and the Word engine's TypeScript settings expect; this resolves such imports to `.ts`.
// Loaded with `node --import ./tests/ts-resolve.mjs --test …`.
import { registerHooks } from 'node:module';

registerHooks({
    resolve(specifier, context, next) {
        if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
            try { return next(`${specifier}.ts`, context); } catch { /* not a TypeScript module: fall through */ }
        }
        return next(specifier, context);
    },
});
