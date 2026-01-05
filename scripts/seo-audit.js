#!/usr/bin/env node
/**
 * SEO Audit Script
 * Scans HTML files for common SEO issues
 */

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

// SEO checks to perform
const SEO_CHECKS = [
  {
    name: 'Missing H1 Tag',
    check: (content, frontmatter) => {
      const h1Match = content.match(/<h1[^>]*>/i);
      return !h1Match;
    },
    severity: 'error',
  },
  {
    name: 'Multiple H1 Tags',
    check: (content, frontmatter) => {
      const h1Matches = content.match(/<h1[^>]*>/gi);
      return h1Matches && h1Matches.length > 1;
    },
    severity: 'warning',
    details: (content) => {
      const h1Matches = content.match(/<h1[^>]*>/gi);
      return `Found ${h1Matches ? h1Matches.length : 0} h1 tags`;
    },
  },
  {
    name: 'Missing Title',
    check: (content, frontmatter) => {
      return !frontmatter.title || frontmatter.title.trim() === '';
    },
    severity: 'error',
  },
  {
    name: 'Missing Description',
    check: (content, frontmatter) => {
      return !frontmatter.description || frontmatter.description.trim() === '';
    },
    severity: 'error',
  },
  {
    name: 'Truncated Description',
    check: (content, frontmatter) => {
      if (!frontmatter.description) return false;
      // Check if description ends abruptly (common truncation indicators)
      const desc = frontmatter.description.trim();
      return desc.length > 50 && (
        desc.endsWith('...') ||
        desc.match(/\s\w{1,3}$/) || // ends with short word fragment
        !desc.match(/[.!?"]$/) // doesn't end with proper punctuation
      );
    },
    severity: 'warning',
    details: (content, frontmatter) => {
      return `"${frontmatter.description.substring(0, 80)}..."`;
    },
  },
  {
    name: 'Description Too Short',
    check: (content, frontmatter) => {
      if (!frontmatter.description) return false;
      return frontmatter.description.length < 50;
    },
    severity: 'warning',
    details: (content, frontmatter) => {
      return `${frontmatter.description.length} chars (recommended: 120-160)`;
    },
  },
  {
    name: 'Description Too Long',
    check: (content, frontmatter) => {
      if (!frontmatter.description) return false;
      return frontmatter.description.length > 160;
    },
    severity: 'info',
    details: (content, frontmatter) => {
      return `${frontmatter.description.length} chars (recommended: 120-160)`;
    },
  },
  {
    name: 'Missing OG Image',
    check: (content, frontmatter) => {
      return !frontmatter.ogImage || frontmatter.ogImage.trim() === '';
    },
    severity: 'warning',
  },
  {
    name: 'Images Missing Alt Text',
    check: (content, frontmatter) => {
      const imgNoAlt = content.match(/<img(?![^>]*alt=)[^>]*>/gi);
      const imgEmptyAlt = content.match(/<img[^>]*alt=["']\s*["'][^>]*>/gi);
      return (imgNoAlt && imgNoAlt.length > 0) || (imgEmptyAlt && imgEmptyAlt.length > 0);
    },
    severity: 'warning',
    details: (content) => {
      const imgNoAlt = content.match(/<img(?![^>]*alt=)[^>]*>/gi) || [];
      const imgEmptyAlt = content.match(/<img[^>]*alt=["']\s*["'][^>]*>/gi) || [];
      return `${imgNoAlt.length} missing, ${imgEmptyAlt.length} empty`;
    },
  },
  {
    name: 'Contains HTML Entities',
    check: (content, frontmatter) => {
      const titleHasEntities = frontmatter.title && /&#\d+;|&[a-z]+;/i.test(frontmatter.title);
      const descHasEntities = frontmatter.description && /&#\d+;|&[a-z]+;/i.test(frontmatter.description);
      return titleHasEntities || descHasEntities;
    },
    severity: 'warning',
    details: (content, frontmatter) => {
      const entities = [];
      if (frontmatter.title) {
        const titleMatches = frontmatter.title.match(/&#\d+;|&[a-z]+;/gi);
        if (titleMatches) entities.push(...titleMatches);
      }
      if (frontmatter.description) {
        const descMatches = frontmatter.description.match(/&#\d+;|&[a-z]+;/gi);
        if (descMatches) entities.push(...descMatches);
      }
      return `Found: ${[...new Set(entities)].join(', ')}`;
    },
  },
  {
    name: 'Missing Canonical URL',
    check: (content, frontmatter) => {
      return !frontmatter.ogUrl && !frontmatter.canonicalUrl;
    },
    severity: 'info',
  },
];

// Parse YAML frontmatter
function parseFrontmatter(content) {
  // Handle both Unix and Windows line endings
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const match = normalizedContent.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const frontmatter = {};

  // Simple YAML parser for key: "value" pairs
  const lines = yaml.split('\n');
  for (const line of lines) {
    // Match key: "value" or key: 'value' or key: value
    const keyMatch = line.match(/^(\w+):\s*["'](.*)["']\s*$/) || line.match(/^(\w+):\s*(.+?)\s*$/);
    if (keyMatch) {
      frontmatter[keyMatch[1]] = keyMatch[2];
    }
  }

  return frontmatter;
}

// Track statistics
const stats = {
  filesScanned: 0,
  issuesByType: {},
  issuesBySeverity: { error: 0, warning: 0, info: 0 },
  fileIssues: [],
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const showAll = process.argv.includes('--all');
  const jsonOutput = process.argv.includes('--json');
  const severityFilter = process.argv.find(arg => arg.startsWith('--severity='));
  const minSeverity = severityFilter ? severityFilter.split('=')[1] : 'info';

  const severityLevels = { error: 3, warning: 2, info: 1 };
  const minLevel = severityLevels[minSeverity] || 1;

  console.log('🔍 SEO Audit Script');
  console.log('==================\n');

  // Find all HTML files
  const files = await glob('**/index.html', {
    cwd: process.cwd(),
    ignore: ['node_modules/**', '_site/**', '_includes/**', 'scripts/**'],
  });

  console.log(`Found ${files.length} HTML files to scan\n`);

  for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = parseFrontmatter(content);

    stats.filesScanned++;

    const fileIssues = [];

    for (const check of SEO_CHECKS) {
      if (severityLevels[check.severity] < minLevel) continue;

      const hasIssue = check.check(content, frontmatter);
      if (hasIssue) {
        const issue = {
          check: check.name,
          severity: check.severity,
          details: check.details ? check.details(content, frontmatter) : null,
        };
        fileIssues.push(issue);

        stats.issuesByType[check.name] = (stats.issuesByType[check.name] || 0) + 1;
        stats.issuesBySeverity[check.severity]++;
      }
    }

    if (fileIssues.length > 0) {
      stats.fileIssues.push({
        file: file,
        title: frontmatter.title || '(no title)',
        issues: fileIssues,
      });
    }
  }

  // Output results
  if (jsonOutput) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  // Group by issue type for summary
  console.log('Issues by Type:');
  console.log('---------------');
  const sortedIssues = Object.entries(stats.issuesByType)
    .sort((a, b) => b[1] - a[1]);

  for (const [issue, count] of sortedIssues) {
    const check = SEO_CHECKS.find(c => c.name === issue);
    const icon = check.severity === 'error' ? '❌' : check.severity === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`  ${icon} ${issue}: ${count} files`);
  }

  console.log('\n\nDetailed Issues by File:');
  console.log('========================\n');

  // Sort by number of issues (most first)
  stats.fileIssues.sort((a, b) => b.issues.length - a.issues.length);

  for (const fileData of stats.fileIssues) {
    const errorCount = fileData.issues.filter(i => i.severity === 'error').length;
    const warningCount = fileData.issues.filter(i => i.severity === 'warning').length;

    if (!showAll && errorCount === 0 && warningCount === 0) continue;

    console.log(`📄 ${fileData.file}`);
    console.log(`   Title: "${fileData.title}"`);

    for (const issue of fileData.issues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
      const details = issue.details ? ` - ${issue.details}` : '';
      console.log(`   ${icon} ${issue.check}${details}`);
    }
    console.log('');
  }

  // Summary
  console.log('\n📊 Summary');
  console.log('==========');
  console.log(`Files scanned: ${stats.filesScanned}`);
  console.log(`Files with issues: ${stats.fileIssues.length}`);
  console.log(`\nBy severity:`);
  console.log(`  ❌ Errors: ${stats.issuesBySeverity.error}`);
  console.log(`  ⚠️  Warnings: ${stats.issuesBySeverity.warning}`);
  console.log(`  ℹ️  Info: ${stats.issuesBySeverity.info}`);
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
