const fs = require('fs');
const path = require('path');

function fixDirectory(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file.endsWith('.json')) {
            const filepath = path.join(dir, file);
            try {
                let content = fs.readFileSync(filepath, 'utf8');
                // The replacement character \uFFFD is what we see as 
                // Sometimes it's followed by ?
                // The string might look like: `\uFFFD?,` or just `?,`
                
                // Let's replace the missing quotes
                let fixed = content
                    .replace(/\ufffd*\?,(\r?\n)/g, '",$1')
                    .replace(/\ufffd*\?(\r?\n)/g, '"$1');

                try {
                    JSON.parse(fixed);
                    fs.writeFileSync(filepath, fixed, 'utf8');
                    console.log(`Fixed successfully: ${file}`);
                } catch (e2) {
                    console.log(`Failed to fix ${file}: ${e2.message}`);
                }
            } catch(e) {
                console.error(`Error reading ${file}: ${e.message}`);
            }
        }
    }
}

fixDirectory('mathreact/public/data');
fixDirectory('data/chapters');
