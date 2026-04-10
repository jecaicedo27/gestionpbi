import imageCompression from 'browser-image-compression';

/**
 * Compresses an image file for faster uploading.
 * Useful for mobile users where camera photos can be 5-15MB.
 *
 * @param {File} file - The original image file
 * @param {Object} [options] - Custom compression options
 * @returns {Promise<File>} - The compressed file (or original if fails/not image)
 */
export async function compressImage(file, options = {}) {
    // If not an image, or it's a small image (< 300KB), return as is
    if (!file.type.startsWith('image/') || file.size < 300 * 1024) {
        return file;
    }

    const defaultOptions = {
        maxSizeMB: 0.8,          // target max size (800KB)
        maxWidthOrHeight: 1920,  // max width/height
        useWebWorker: true,
        fileType: 'image/jpeg',
    };

    try {
        const compressedFile = await imageCompression(file, { ...defaultOptions, ...options });
        
        // Return compressed only if it's actually smaller
        return compressedFile.size < file.size ? compressedFile : file;
    } catch (error) {
        console.warn('Image compression failed, using original file:', error);
        return file;
    }
}
