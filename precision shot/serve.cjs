const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const allowed = new Set(['index.html','style.css','layout.css','game.js','assets/rifle-olive.png','assets/rifle-transparent.png','assets/range-background.png']);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
http.createServer((req,res)=>{
  const name = new URL(req.url,'http://localhost').pathname.slice(1) || 'index.html';
  if(!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}
  fs.readFile(path.join(__dirname,name),(err,data)=>{
    if(err){res.writeHead(500);res.end('Could not read file');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':'no-store'});res.end(data);
  });
}).listen(5187,'127.0.0.1',()=>console.log('Precision Shot: http://localhost:5187'));

