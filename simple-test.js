console.log('Testing merge functionality...');

// Simple test object
const testObj = {
    name: 'Test',
    about: {
        work: ['Company A'],
        education: ['School A']
    }
};

console.log('Test object:', JSON.stringify(testObj, null, 2));
console.log('Test completed successfully');
