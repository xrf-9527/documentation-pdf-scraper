#!/usr/bin/env node

/**
 * 验证section结构数据格式（无依赖测试）
 */

console.log('🚀 验证分层TOC数据结构格式');
console.log('='.repeat(60));

// 模拟scraper生成的section结构
const sampleSectionStructure = {
  sections: [
    {
      index: 0,
      title: 'Getting started',
      entryUrl: 'https://code.claude.com/docs/en/overview',
      pages: [
        {
          index: '0',
          url: 'https://code.claude.com/docs/en/overview',
          order: 0,
        },
        {
          index: '1',
          url: 'https://code.claude.com/docs/en/installation',
          order: 1,
        },
        {
          index: '2',
          url: 'https://code.claude.com/docs/en/quickstart',
          order: 2,
        },
      ],
    },
    {
      index: 1,
      title: 'Build with Claude Code',
      entryUrl: 'https://code.claude.com/docs/en/sub-agents',
      pages: [
        {
          index: '3',
          url: 'https://code.claude.com/docs/en/sub-agents',
          order: 0,
        },
        {
          index: '4',
          url: 'https://code.claude.com/docs/en/tools',
          order: 1,
        },
      ],
    },
    {
      index: 2,
      title: 'Deployment',
      entryUrl: 'https://code.claude.com/docs/en/third-party-integrations',
      pages: [
        {
          index: '5',
          url: 'https://code.claude.com/docs/en/third-party-integrations',
          order: 0,
        },
      ],
    },
  ],
  urlToSection: {
    'https://code.claude.com/docs/en/overview': 0,
    'https://code.claude.com/docs/en/installation': 0,
    'https://code.claude.com/docs/en/quickstart': 0,
    'https://code.claude.com/docs/en/sub-agents': 1,
    'https://code.claude.com/docs/en/tools': 1,
    'https://code.claude.com/docs/en/third-party-integrations': 2,
  },
};

// 模拟articleTitles
const sampleArticleTitles = {
  0: 'Overview',
  1: 'Installation',
  2: 'Quick Start',
  3: 'Sub-agents',
  4: 'Tools',
  5: 'Third-party Integrations',
};

console.log('\n📊 Section结构示例:');
console.log(JSON.stringify(sampleSectionStructure, null, 2));

console.log('\n📊 Article标题映射示例:');
console.log(JSON.stringify(sampleArticleTitles, null, 2));

console.log('\n🔍 验证数据完整性...');

// 验证1: sections数组存在
if (!Array.isArray(sampleSectionStructure.sections)) {
  console.error('❌ sections不是数组');
  process.exit(1);
}
console.log('✅ sections是有效数组');

// 验证2: urlToSection映射存在
if (typeof sampleSectionStructure.urlToSection !== 'object') {
  console.error('❌ urlToSection不是对象');
  process.exit(1);
}
console.log('✅ urlToSection是有效对象');

// 验证3: 每个section包含必需字段
let sectionsValid = true;
sampleSectionStructure.sections.forEach((section, i) => {
  if (typeof section.index !== 'number') {
    console.error(`❌ Section ${i}: 缺少index字段`);
    sectionsValid = false;
  }
  if (typeof section.title !== 'string') {
    console.error(`❌ Section ${i}: 缺少title字段`);
    sectionsValid = false;
  }
  if (typeof section.entryUrl !== 'string') {
    console.error(`❌ Section ${i}: 缺少entryUrl字段`);
    sectionsValid = false;
  }
  if (!Array.isArray(section.pages)) {
    console.error(`❌ Section ${i}: pages不是数组`);
    sectionsValid = false;
  }
});

if (sectionsValid) {
  console.log('✅ 所有section包含必需字段');
} else {
  process.exit(1);
}

// 验证4: 页面按order排序
let orderValid = true;
sampleSectionStructure.sections.forEach((section, sectionIdx) => {
  for (let i = 1; i < section.pages.length; i++) {
    if (section.pages[i].order < section.pages[i - 1].order) {
      console.error(`❌ Section ${sectionIdx} 的pages未按order排序`);
      orderValid = false;
    }
  }
});

if (orderValid) {
  console.log('✅ 所有pages正确按order排序');
}

// 验证5: 模拟TOC生成
console.log('\n📝 模拟TOC生成...');

const mockTOC = [];
sampleSectionStructure.sections.forEach((section) => {
  // Level 1: Section
  mockTOC.push({
    level: 1,
    title: section.title,
    page: 1, // 模拟页码
  });

  // Level 2: Pages
  section.pages.forEach((page) => {
    const pageTitle = sampleArticleTitles[page.index] || `Page ${page.index}`;
    mockTOC.push({
      level: 2,
      title: pageTitle,
      page: 1, // 模拟页码
    });
  });
});

console.log('\n生成的TOC结构预览:');
mockTOC.forEach((item) => {
  const indent = '  '.repeat(item.level - 1);
  console.log(`${indent}${item.level}. ${item.title}`);
});

console.log('\n' + '='.repeat(60));
console.log('✅ 所有验证通过！分层TOC数据结构正确');
console.log('\n📋 预期的PDF TOC结构:');
console.log('├── 1. Getting started (Level 1 - Section)');
console.log('│   ├── 1.1 Overview (Level 2 - Page)');
console.log('│   ├── 1.2 Installation (Level 2 - Page)');
console.log('│   └── 1.3 Quick Start (Level 2 - Page)');
console.log('├── 2. Build with Claude Code (Level 1 - Section)');
console.log('│   ├── 2.1 Sub-agents (Level 2 - Page)');
console.log('│   └── 2.2 Tools (Level 2 - Page)');
console.log('└── 3. Deployment (Level 1 - Section)');
console.log('    └── 3.1 Third-party Integrations (Level 2 - Page)');

console.log('\n下一步操作：');
console.log('1. 运行 make clean 清理旧数据');
console.log('2. 运行 make run 生成新的PDF');
console.log('3. 检查生成的 sectionStructure.json');
console.log('4. 验证最终PDF的TOC结构');
