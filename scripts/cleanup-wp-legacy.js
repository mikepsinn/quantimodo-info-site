#!/usr/bin/env node

/**
 * Cleanup WordPress Legacy Elements
 *
 * Removes outdated WordPress elements from static HTML files:
 * - Social share sections (Facebook, Twitter, Google+, Pinterest, Email)
 * - Jetpack comments sections
 * - Related articles carousels
 * - Pagination navigation (prev/next post links)
 *
 * Usage:
 *   node scripts/cleanup-wp-legacy.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

// Patterns to remove (using regex)
const REMOVAL_PATTERNS = [
  {
    name: 'Social Share Section',
    // Matches the social share wrap section
    pattern: /<section class="main-color container-wrap social-share-wrap">[\s\S]*?<\/section>\s*(?=\n)/g,
  },
  {
    name: 'Related Articles Carousel',
    // Matches the related articles section
    pattern: /<section class="container-wrap">\s*<div class="container">\s*<div class="related-wrap">[\s\S]*?<\/section>\s*(?=\n)/g,
  },
  {
    name: 'Pagination Navigation',
    // Matches the pagination-sticky navigation
    pattern: /\s*<nav class="pagination-sticky[\s\S]*?<\/nav><!-- \.navigation -->\s*/g,
  },
  {
    name: 'Comments Section',
    // Matches the comments section
    pattern: /\s*<!-- Begin Comments -->[\s\S]*?<!-- End Comments -->\s*/g,
  },
];

// Track statistics
const stats = {
  filesScanned: 0,
  filesModified: 0,
  removalsByType: {},
};

/**
 * Remove legacy WordPress elements from content
 */
function cleanupContent(content) {
  let modified = content;
  let totalRemovals = 0;

  for (const { name, pattern } of REMOVAL_PATTERNS) {
    const matches = modified.match(pattern);
    const count = matches ? matches.length : 0;

    if (count > 0) {
      modified = modified.replace(pattern, '');
      totalRemovals += count;
      stats.removalsByType[name] = (stats.removalsByType[name] || 0) + count;
    }
  }

  return { modified, totalRemovals };
}

/**
 * Process a single HTML file
 */
function processFile(filePath, dryRun = false) {
  stats.filesScanned++;

  const content = fs.readFileSync(filePath, 'utf8');
  const { modified, totalRemovals } = cleanupContent(content);

  if (totalRemovals > 0) {
    stats.filesModified++;

    const relativePath = path.relative(process.cwd(), filePath);
    console.log(`✓ ${relativePath}: ${totalRemovals} section(s) removed`);

    if (!dryRun) {
      fs.writeFileSync(filePath, modified, 'utf8');
    }
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('🧹 Cleaning up WordPress legacy elements...\n');

  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No files will be modified\n');
  }

  console.log('Removing:');
  REMOVAL_PATTERNS.forEach(({ name }) => console.log(`  - ${name}`));
  console.log('');

  // Find all HTML files (excluding common directories)
  const files = await glob('**/*.html', {
    ignore: [
      'node_modules/**',
      '_site/**',
      'dist/**',
      '.git/**',
      '_includes/**',
      'perfect-your-life/**', // Skip app files
      'dark-website/**', // Separate site
    ],
  });

  console.log(`Found ${files.length} HTML file(s) to scan\n`);

  // Process each file
  for (const file of files) {
    try {
      processFile(file, dryRun);
    } catch (error) {
      console.error(`✗ Error processing ${file}: ${error.message}`);
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log('='.repeat(60));
  console.log(`Files scanned:    ${stats.filesScanned}`);
  console.log(`Files modified:   ${stats.filesModified}`);

  if (Object.keys(stats.removalsByType).length > 0) {
    console.log('\nRemovals by type:');
    for (const [name, count] of Object.entries(stats.removalsByType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${name.padEnd(30)} ${count}x`);
    }
  }

  if (dryRun && stats.filesModified > 0) {
    console.log('\n⚠️  This was a dry run. Run without --dry-run to apply changes.');
  } else if (stats.filesModified > 0) {
    console.log('\n✅ Cleanup complete!');
  } else {
    console.log('\n✓ No legacy elements found to remove.');
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
