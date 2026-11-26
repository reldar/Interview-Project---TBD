// Fictional data-intern interview fixtures shared by offline consumers.
const questions = (pairs) => ({
  questions: pairs.map(([questionText, focusArea], index) => ({
    questionNumber: index + 1,
    questionText,
    focusArea,
  })),
});

export const INTERVIEW_FIXTURES = {
  sanitizedCvText: 'Built a Python script to clean duplicate rows. Helped make weekly reports in Excel. Wrote instructions for the reports.',
  sanitizedJd: 'Data intern. Python, Excel and SQL required. Collaborate on weekly reporting.',
  hrd: {
    id: questions([
      ['Dengan panduan laporan mingguan yang kamu tulis, bagaimana kamu akan membantu rekan menyiapkan laporan?', 'Komunikasi dan kerja sama'],
      ['Bagian mana dari magang data ini yang paling menarik bagimu setelah membuat laporan di Excel?', 'Motivasi'],
      ['Bagaimana kamu akan menjaga konsistensi laporan jika beberapa rekan bergantian menyiapkannya?', 'Cara kerja tim'],
      ['Jika rekan meminta perubahan laporan mendekati tenggat, bagaimana kamu menyepakati prioritas?', 'Penyelesaian konflik'],
      ['Keterampilan apa yang ingin kamu kembangkan dalam magang ini, dan bagaimana kamu akan mengukur kemajuannya?', 'Pengembangan karier'],
    ]),
    en: questions([
      ['How would you use the weekly report instructions you wrote to help a teammate prepare a report?', 'Communication and teamwork'],
      ['After helping with Excel reports, what interests you most about this data internship?', 'Motivation'],
      ['How would you keep weekly reports consistent if teammates took turns preparing them?', 'Team practices'],
      ['If a teammate asked for a reporting change close to a deadline, how would you agree on priorities?', 'Conflict resolution'],
      ['Which skill would you develop during this internship, and how would you measure your progress?', 'Career development'],
    ]),
  },
  user: {
    id: questions([
      ['Bagaimana kamu menentukan baris mana yang dianggap duplikat dalam skrip Python?', 'Pembersihan data'],
      ['Bagaimana kamu menguji bahwa skrip mempertahankan baris yang valid?', 'Pengujian'],
      ['Jika harus mencari ID berulang dengan SQL, bagaimana kamu akan menyusun kuerinya?', 'Skenario SQL'],
      ['Bagaimana kamu akan memeriksa selisih total dalam laporan mingguan Excel?', 'Penelusuran kesalahan'],
      ['Jika tim perlu mengulang pembersihan setiap minggu, bagaimana kamu akan mendokumentasikan prosesnya?', 'Desain proses'],
    ]),
    en: questions([
      ['How did you decide which rows counted as duplicates in your Python script?', 'Data cleaning'],
      ['How would you test that the script kept valid rows?', 'Testing'],
      ['If asked to find repeated IDs in SQL, how would you structure the query?', 'SQL scenario'],
      ['How would you investigate a total that differed in the weekly Excel report?', 'Troubleshooting'],
      ['If the team had to repeat the cleanup weekly, how would you document the process?', 'Process design'],
    ]),
  },
};
