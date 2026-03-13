require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function reproduce() {
    try {
        // 1. Get valid user and product
        const user = await prisma.user.findFirst();
        const product = await prisma.product.findFirst();

        if (!user || !product) {
            console.error('No user or product found to test with.');
            return;
        }


        console.log(`Using User: ${user.id}, Product: ${product.id}`);

        const jwt = require('jsonwebtoken');
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });


        // 2. Prepare Form Data
        const formData = new FormData();
        formData.append('userId', user.id);

        const items = [{
            type: 'OTRO',
            productId: product.id,
            quantity: 1,
            unit: 'UNIDADES',
            lotNumber: 'TEST-LOT',
            description: 'Test PQR Description',
            evidenceCount: 1
        }];

        formData.append('items', JSON.stringify(items));

        // Create a dummy file
        fs.writeFileSync('test-evidence.jpg', 'fake image content');
        formData.append('evidence', fs.createReadStream('test-evidence.jpg'));

        // 3. Send Request
        const response = await axios.post('http://localhost:3051/api/pqr', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('Success:', response.status, response.data);

    } catch (error) {
        if (error.response) {
            console.error('Error Response:', error.response.status, error.response.statusText);
            console.error('Data:', error.response.data);
        } else {
            console.error('Error:', error.message);
        }
    } finally {
        await prisma.$disconnect();
        if (fs.existsSync('test-evidence.txt')) fs.unlinkSync('test-evidence.txt');
    }
}

reproduce();
