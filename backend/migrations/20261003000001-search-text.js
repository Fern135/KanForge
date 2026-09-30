'use strict';

// Search only reads the first 20,000 characters of each note's and document's
// plain-text copy (see core/services/search.js), so one search can't make the
// database read gigabytes. Trims the copies already stored. The content itself
// isn't touched.
const SEARCH_TEXT_MAX = 20_000;
const COLLECTIONS = ['notes', 'office_documents'];

module.exports = {
  async up(db) {
    for (const name of COLLECTIONS) {
      await db.collection(name).updateMany(
        { $expr: { $gt: [{ $strLenCP: { $ifNull: ['$text', ''] } }, SEARCH_TEXT_MAX] } },
        [{ $set: { text: { $substrCP: ['$text', 0, SEARCH_TEXT_MAX] } } }],
      );
    }
  },

  // The trimmed text can't be restored here. Each item's full search copy comes
  // back the next time it's saved.
  async down() {},
};
