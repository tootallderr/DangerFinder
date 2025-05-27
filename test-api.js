const http = require('http');

const testAPI = (path) => {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: 'GET'
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    resolve(data);
                }
            });
        });
        
        req.on('error', reject);
        req.end();
    });
};

async function test() {
    try {
        console.log('Testing /api/graph...');
        const graph = await testAPI('/api/graph');
        console.log('Graph keys:', Object.keys(graph));
        console.log('Nodes type:', typeof graph.nodes);
        console.log('Adjacency list type:', typeof graph.adjacency_list);
        
        if (graph.nodes) {
            console.log('Sample nodes:', Object.keys(graph.nodes).slice(0, 3));
        }
        
        if (graph.adjacency_list) {
            const firstKey = Object.keys(graph.adjacency_list)[0];
            if (firstKey) {
                console.log('Sample adjacency:', firstKey, '->', graph.adjacency_list[firstKey].slice(0, 3));
            }
        }
        
        console.log('\nTesting /api/stats...');
        const stats = await testAPI('/api/stats');
        console.log('Stats:', stats);
        
    } catch (error) {
        console.error('Error:', error);
    }
}

test();
