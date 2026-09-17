// Provider errors are untrusted and may contain credentials. Return fixed labels only.
const codes = ['EACCES','EPERM','ENOENT','EROFS','ENOTDIR','EADDRINUSE',
  'ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','ENOTFOUND',
  'ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN','CERT_HAS_EXPIRED'];
const methods = new Set(['initialize','authenticate','session/new','session/load','session/prompt']);
export function rpcDiagnostic(error, method) {
  const parts = [];
  function collect(value, depth = 0) {
    if (depth > 4 || parts.length >= 20) return;
    if (typeof value === 'string') parts.push(value.slice(0, 8192));
    else if (value && typeof value === 'object') {
      for (const key of ['message','code','data','cause','error','details']) collect(value[key],depth+1);
    }
  }
  collect(error);
  const detail = parts.join(' ');
  const signals = codes.filter(code => new RegExp('\\b'+code+'\\b').test(detail));
  for (const [signal, pattern] of [
    ['http_403', /\bHTTP 403\b/i],
    ['permission_denied', /\[permission_denied\]/i],
    ['method_policy_denied', /method not allowed in limited mode|blocked-by-method-policy/i],
    ['authentication_required', /authentication required|unauthenticated/i],
    ['login_expired', /login failed or timed out|login.*expired/i],
    ['network_denied', /proxy.*denied|network.*denied|blocked by.*proxy/i],
    ['service_initialization_failed', /failed to initialize.*services/i],
    ['certificate_error', /certificate|tls handshake/i],
  ]) if (pattern.test(detail)) signals.push(signal);
  return {method:methods.has(method)?method:'other',
    code:Number.isSafeInteger(error?.code)?error.code:null,
    signals, detail_withheld:true};
}
