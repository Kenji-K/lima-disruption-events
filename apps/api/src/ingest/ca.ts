import { readFileSync } from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';

/**
 * www.munlima.gob.pe serves an incomplete TLS chain (verified 2026-06-11): the
 * leaf and a USERTrust root, but NOT the issuing intermediate ("Sectigo Public
 * Server Authentication CA OV R36"). Browsers and macOS curl silently repair
 * such chains by fetching the issuer from the leaf's AIA URL; Node's OpenSSL
 * does not, so every fetch against MML fails with
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE — on dev machines and in the Fly container
 * alike.
 *
 * Remedy: append that public intermediate (downloaded from the leaf's own AIA
 * pointer, http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt,
 * valid to 2036) to the process-default CA set. Strictly additive — the
 * default Mozilla roots stay authoritative; this only supplies the middle link
 * the server forgot. Loaded as a side effect from fetch.ts so every scraper
 * shares one TLS posture. Remove if/when MML fixes their server config.
 */
const intermediates = ['sectigo-public-server-authentication-ca-ov-r36.pem'].map((file) =>
    readFileSync(path.join(import.meta.dirname, 'certs', file), 'utf8'),
);

tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...intermediates]);
