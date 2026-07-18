'use strict';

// Blob-backed post store. The ContainerClient is injected so tests can use fakes.
// Layout: posts/<slug>.json (one post per blob), uploads/<file> (images),
// documents/<file> (site documents, e.g. terms & conditions).

async function streamToBuffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function createBlogStore(containerClient) {
  async function downloadJson(name) {
    const res = await containerClient.getBlobClient(name).download();
    return JSON.parse((await streamToBuffer(res.readableStreamBody)).toString('utf8'));
  }

  return {
    async loadAllPosts() {
      const names = [];
      for await (const blob of containerClient.listBlobsFlat({ prefix: 'posts/' })) {
        if (blob.name.endsWith('.json')) names.push(blob.name);
      }
      return Promise.all(names.map(downloadJson));
    },

    async getPost(slug) {
      try {
        return await downloadJson(`posts/${slug}.json`);
      } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
      }
    },

    async savePost(post) {
      const body = JSON.stringify(post, null, 2);
      await containerClient.getBlockBlobClient(`posts/${post.name}.json`).upload(
        Buffer.from(body), Buffer.byteLength(body),
        { blobHTTPHeaders: { blobContentType: 'application/json' } });
    },

    async deletePost(slug) {
      await containerClient.getBlobClient(`posts/${slug}.json`).deleteIfExists();
    },

    async getMedia(file) {
      return downloadBinary(`uploads/${file}`);
    },

    async uploadImage(name, buffer, contentType) {
      await uploadBinary(`uploads/${name}`, buffer, contentType);
    },

    async listDocuments() {
      const docs = [];
      for await (const blob of containerClient.listBlobsFlat({ prefix: 'documents/' })) {
        docs.push({
          name: blob.name.slice('documents/'.length),
          size: blob.properties && typeof blob.properties.contentLength === 'number'
            ? blob.properties.contentLength : null,
          lastModified: blob.properties && blob.properties.lastModified
            ? new Date(blob.properties.lastModified).toISOString() : null,
        });
      }
      return docs;
    },

    async getDocument(file) {
      return downloadBinary(`documents/${file}`);
    },

    async uploadDocument(name, buffer, contentType) {
      await uploadBinary(`documents/${name}`, buffer, contentType);
    },

    async deleteDocument(name) {
      await containerClient.getBlobClient(`documents/${name}`).deleteIfExists();
    },
  };

  async function downloadBinary(blobName) {
    try {
      const res = await containerClient.getBlobClient(blobName).download();
      return {
        buffer: await streamToBuffer(res.readableStreamBody),
        contentType: res.contentType || 'application/octet-stream',
      };
    } catch (err) {
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  async function uploadBinary(blobName, buffer, contentType) {
    await containerClient.getBlockBlobClient(blobName).upload(
      buffer, buffer.length, { blobHTTPHeaders: { blobContentType: contentType } });
  }
}

module.exports = { createBlogStore };
