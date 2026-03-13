try {
    console.log('Testing dependencies...');
    require('bcrypt');
    console.log('bcrypt matches');
} catch (e) {
    console.log('bcrypt failed:', e.code);
}

try {
    require('@prisma/client');
    console.log('@prisma/client matches');
} catch (e) {
    console.log('@prisma/client failed:', e.code);
}
