// ============================================
// ESSAY REGISTRY
// ============================================
// This file lists all available essays.
// Add new essays by:
// 1. Creating a new file in config/essays/
// 2. Adding an entry to the ESSAY_LIST below
// 3. Adding a <script> tag in index.html
// ============================================

window.ESSAY_LIST = [
  {
    id: 'christmas-carol',
    title: "A Christmas Carol - Character Analysis",
    subject: "English Literature",
    yearGroup: "Year 9",
    description: "Analyse Scrooge's transformation through Dickens' novella",
    icon: "📚",
    paragraphs: 7,
    totalMarks: 30
  },
  {
    id: 'creativenov23',
    title: "Paper 1 Nov 22 Description Task",
    subject: "English Literature",
    yearGroup: "Year 11",
    description: "Describe a place at sunset as suggested by this pictureAnalyse Scrooge's transformation through Dickens' novella",
    icon: "📚",
    paragraphs: 5,
    totalMarks: 40
  },
  {
    id: 'mobile-phones-ban',
    title: "Mobile Phones in Schools",
    subject: "English Language",
    yearGroup: "Year 11",
    description: "Argumentative article on banning phones in schools",
    icon: "📱",
    paragraphs: 5,
    totalMarks: 40
  }
  // Add more essays here as you create them
];

// Global settings that apply to all essays
window.GLOBAL_CONFIG = {
  siteName: "Essay Writing Practice",
  teacherPassword: "teacher123",
  supportEmail: "", // Optional: add support email
  schoolName: "", // Optional: add school name
};
