"use strict";

const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const {
  categories,
  contributors,
  articles,
  pages,
  global,
} = require("../../data/data.json");

async function isFirstRun() {
  const pluginStore = strapi.store({
    environment: strapi.config.environment,
    type: "type",
    name: "setup",
  });
  const initHasRun = await pluginStore.get({ key: "initHasRun" });
  await pluginStore.set({ key: "initHasRun", value: true });
  return !initHasRun;
}

async function setPublicPermissions(newPermissions) {
  // Find the ID of the public role
  const publicRole = await strapi
    .query("role", "users-permissions")
    .findOne({ type: "public" });

  // List all available permissions
  const publicPermissions = await strapi
    .query("permission", "users-permissions")
    .find({
      type: ["users-permissions", "application"],
      role: publicRole.id,
    });

  // Update permission to match new config
  const controllersToUpdate = Object.keys(newPermissions);
  const updatePromises = publicPermissions
    .filter((permission) => {
      // Only update permissions included in newConfig
      if (!controllersToUpdate.includes(permission.controller)) {
        return false;
      }
      if (!newPermissions[permission.controller].includes(permission.action)) {
        return false;
      }
      return true;
    })
    .map((permission) => {
      // Enable the selected permissions
      return strapi
        .query("permission", "users-permissions")
        .update({ id: permission.id }, { enabled: true });
    });
  await Promise.all(updatePromises);
}

function getFileSizeInBytes(filePath) {
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats["size"];
  return fileSizeInBytes;
}

function getFileData(fileName) {
  const filePath = `./data/uploads/${fileName}`;

  // Parse the file metadata
  const size = getFileSizeInBytes(filePath);
  const ext = fileName.split(".").pop();
  const mimeType = mime.lookup(ext);

  return {
    path: filePath,
    name: fileName,
    size,
    type: mimeType,
  };
}

// Create an entry and attach files if there are any
async function createEntry({ model, entry, files }) {
  try {
    const createdEntry = await strapi.query(model).create(entry);
    if (files) {
      await strapi.entityService.uploadFiles(createdEntry, files, {
        model,
      });
    }
  } catch (e) {
    console.log("model", entry, e);
  }
}

async function importCategories() {
  return Promise.all(
    categories.map((category) => {
      return createEntry({ model: "category", entry: category });
    })
  );
}

async function importContributors() {
  return Promise.all(
    contributors.map(async (contributor) => {
      const files = {
        "featured.profile_image": getFileData(`${contributor.slug}.jpeg`),
      };
      return createEntry({
        model: "contributor",
        entry: contributor,
        files,
      });
    })
  );
}

async function importPages() {
  return Promise.all(
    pages.map(async (page) => {
      const files = {
        cover: getFileData("laptop.jpeg"),
      };
      return createEntry({
        model: "pages",
        entry: page,
        files,
      });
    })
  );
}

// Randomly set relations on Article to avoid error with MongoDB
function getEntryWithRelations(article, categories, authors) {
  const isMongoose = strapi.config.connections.default.connector == "mongoose";

  if (isMongoose) {
    const randomRelation = (relation) =>
      relation[Math.floor(Math.random() * relation.length)].id;
    delete article.category.id;
    delete article.author.id;

    return {
      ...article,
      category: {
        _id: randomRelation(categories),
      },
      author: {
        _id: randomRelation(authors),
      },
    };
  }

  return article;
}

async function importArticles() {
  const categories = await strapi.query("category").find();
  const authors = await strapi.query("contributor").find();

  return Promise.all(
    articles.map((article) => {
      // Get relations for each article
      const entry = getEntryWithRelations(article, categories, authors);

      const files = {
        cover: getFileData(`${article.slug}.jpeg`),
      };

      return createEntry({
        model: "article",
        entry,
        files,
      });
    })
  );
}

async function importGlobal() {
  const files = {
    cover: getFileData("seo-cover.jpeg"),
  };
  return createEntry({ model: "global", entry: global, files });
}

async function importSeedData() {
  // Allow read of application content types
  await setPublicPermissions({
    global: ["find"],
    article: ["find", "findone"],
    pages: ["find", "findone"],
    category: ["find", "findone"],
    contributor: ["find", "findone"],
  });

  // Create all entries
  await importCategories();
  await importContributors();
  await importPages();
  await importArticles();
  await importGlobal();
}

module.exports = async () => {
  const shouldImportSeedData = await isFirstRun();

  if (shouldImportSeedData) {
    try {
      console.log("Setting up the template...");
      await importSeedData();
      console.log("Ready to go");
    } catch (error) {
      console.log("Could not import seed data");
      console.error(error);
    }
  }
};
