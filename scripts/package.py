from pathlib import Path
import hashlib,json,os,shutil,subprocess,zipfile

root=Path(__file__).resolve().parents[1]
dist=root/'dist';dist.mkdir(exist_ok=True)
go=os.environ.get('GO_BINARY','go')
version=json.loads((root/'plugin/komari-plugin.json').read_text(encoding='utf8'))['version']
meta={'version':'0.1.0'}
for arch in ('amd64','arm64'):
    name='return-route-collector-linux-'+arch
    env=os.environ.copy();env.update(GOOS='linux',GOARCH=arch,CGO_ENABLED='0')
    subprocess.run([go,'build','-trimpath','-buildvcs=false','-ldflags=-s -w','-o',str(dist/name),'./cmd/return-route-collector'],cwd=root,env=env,check=True)
    digest=hashlib.sha256((dist/name).read_bytes()).hexdigest()
    meta[arch]={'sha256':digest,'url':'https://github.com/yinpengfei/komari-plugin-return-route/releases/download/v'+version+'/'+name}
(root/'plugin/artifacts.json').write_text(json.dumps(meta,indent=2)+'\n',encoding='utf8')
archive=dist/('komari-plugin-return-route-'+version+'.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for file in sorted((root/'plugin').rglob('*')):
        if file.is_file():z.write(file,file.relative_to(root/'plugin').as_posix())
    for name in ('LICENSE','NOTICE'):z.write(root/name,name)
files=[archive]+[dist/('return-route-collector-linux-'+arch) for arch in ('amd64','arm64')]
(dist/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(files)),encoding='utf8')
print(json.dumps({'archive':str(archive),'collectors':meta},ensure_ascii=False))
