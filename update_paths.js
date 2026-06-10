const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const baseUrl = 'https://hospital-website-git-main-kollivarshini020705-3455s-projects.vercel.app';

html = html.replace(/fetch\('\/api\//g, `fetch('${baseUrl}/api/`);
html = html.replace(/fetch\(\`\/api\//g, `fetch(\`${baseUrl}/api/`);

fs.writeFileSync('index.html', html);
console.log("Updated index.html fetch paths.");
