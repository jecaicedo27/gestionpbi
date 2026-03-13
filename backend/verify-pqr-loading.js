try {
    const pqrRoutes = require('./src/routes/pqrRoutes');
    console.log('pqrRoutes loaded:', pqrRoutes);
    console.log('Is Router?', typeof pqrRoutes === 'function');
    console.log('Stack length:', pqrRoutes.stack ? pqrRoutes.stack.length : 'N/A');
} catch (error) {
    console.error('Error loading pqrRoutes:', error);
}
