'use strict';

// Blob-backed post store. The ContainerClient is injected so tests can use fakes.
// Layout: posts/<slug>.json (one post per blob), uploads/<file> (images).

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
      try {
        const res = await containerClient.getBlobClient(`uploads/${file}`).download();
        return {
          buffer: await streamToBuffer(res.readableStreamBody),
          contentType: res.contentType || 'application/octet-stream',
        };
      } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
      }
    },

    async uploadImage(name, buffer, contentType) {
      await containerClient.getBlockBlobClient(`uploads/${name}`).upload(
        buffer, buffer.length, { blobHTTPHeaders: { blobContentType: contentType } });
    },
  };
}

module.exports = { createBlogStore };
