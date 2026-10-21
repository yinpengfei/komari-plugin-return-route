'use strict';
const BIN='/opt/komari-return-route/collector';
function quote(s){return "'"+String(s).replace(/'/g,"'\\''")+"'";}
function probe(config){return 'if [ "$(uname -s)" != Linux ]; then printf \'unsupported_system\\n\'; exit 1; fi\nif [ ! -x '+quote(BIN)+' ]; then printf \'collector_missing\\n\'; exit 1; fi\nexec '+quote(BIN)+' --config-b64 '+quote(Buffer.from(JSON.stringify(config),'utf8').toString('base64'));}
function install(artifacts){
  if(artifacts.version!=='0.1.0')throw Error('invalid collector metadata');
  for(const arch of ['amd64','arm64']){
    const item=artifacts[arch];
    if(!item||!/^([a-f0-9]{64})$/.test(item.sha256)||item.url!=='https://github.com/yinpengfei/komari-plugin-return-route/releases/download/v0.1.1/return-route-collector-linux-'+arch)throw Error('invalid release artifact');
  }
  return [
    'set -eu','umask 077','[ "$(uname -s)" = Linux ] || { echo unsupported_system; exit 1; }',
    '[ "$(id -u)" = 0 ] || { echo installation_requires_root; exit 1; }',
    'case "$(uname -m)" in',
    'x86_64) url='+quote(artifacts.amd64.url)+'; expected='+quote(artifacts.amd64.sha256)+';;',
    'aarch64|arm64) url='+quote(artifacts.arm64.url)+'; expected='+quote(artifacts.arm64.sha256)+';;',
    '*) echo unsupported_architecture; exit 1;; esac',
    "dir='/opt/komari-return-route'",'[ ! -L "$dir" ] || { echo symlink_refused; exit 1; }',
    'mkdir -p "$dir"','chmod 755 "$dir"','[ ! -L "$dir/collector" ] || { echo symlink_refused; exit 1; }',
    'tmp=$(mktemp "$dir/.collector.XXXXXX")',"trap 'rm -f -- \"$tmp\"' EXIT HUP INT TERM",
    'curl --proto \'=https\' --proto-redir \'=https\' --tlsv1.2 -fsSL --max-time 90 "$url" -o "$tmp"',
    'printf \'%s  %s\\n\' "$expected" "$tmp" | sha256sum -c - >/dev/null',
    'chmod 755 "$tmp"','[ "$("$tmp" --version)" = 0.1.0 ] || { echo unexpected_version; exit 1; }',
    'mv -f -- "$tmp" "$dir/collector"',"printf 'collector_installed:0.1.0\\n'"
  ].join('\n');
}
module.exports={probe,install,BIN,quote};
