'use client';
import { Button } from './ui/button';
import { useEffect, useRef, useState } from 'react';
import { redactPii } from '../lib/redact';
import { ReportActions } from './report';

const questions = {
  hrd: [
    ['Kapan kamu membantu rekan menggunakan laporan mingguan?', 'When did you help a teammate use a weekly report?', 'Jelaskan cara kamu mengetahui panduannya membantu.', 'Explain how you knew the instructions helped.'],
    ['Mengapa kamu tertarik pada magang data ini?', 'What interests you about this data internship?', 'Hubungkan satu proyek dengan tugas dalam lowongan.', 'Connect one project to a task in the vacancy.'],
    ['Kebiasaan apa yang membantu tim membuat laporan secara konsisten?', 'What team habit would keep weekly reports consistent?', 'Berikan satu contoh kebiasaan yang bisa diulang.', 'Give one example the team could repeat.'],
    ['Bagaimana kamu menyepakati prioritas saat tenggat mendekat?', 'How would you resolve competing priorities near a deadline?', 'Sebutkan tugas yang perlu diselesaikan lebih dahulu.', 'Name the task you would finish first.'],
    ['Keterampilan apa yang ingin kamu kembangkan?', 'Which skill would you like to develop?', 'Jelaskan hasil kerja yang dapat menunjukkan kemajuanmu.', 'Describe one piece of work that would show progress.'],
  ],
  user: [
    ['Bagaimana skrip Python mengenali duplikat?', 'How did the Python script identify duplicates?', 'Sebutkan kolom pembanding dan alasannya.', 'Name the columns you compared and explain why.'],
    ['Bagaimana kamu menguji bahwa baris yang valid tetap tersimpan?', 'How would you check that valid rows were kept?', 'Berikan data uji dan hasil yang diharapkan.', 'Give a test case and the expected result.'],
    ['Bagian mana dari laporan Excel yang kamu kerjakan?', 'Which part of the Excel report did you work on?', 'Jelaskan satu langkah dan hasilnya.', 'Describe one step and its outcome.'],
    ['Jika memakai SQL, bagaimana kamu mencari ID yang berulang?', 'How would you find repeated IDs using SQL?', 'Jelaskan cara mengelompokkan dan menghitung ID.', 'Explain how you would group and count IDs.'],
    ['Bagaimana kamu menelusuri selisih total laporan?', 'How would you investigate a mismatch in report totals?', 'Periksa rentang tanggal dan filter yang digunakan.', 'Check the date range and filters.'],
  ],
};
const scores = [[4,4,3],[3,4,3],[4,4,3],[4,4,4],[4,5,3]];

export function Interview({en,report,onStage}) {
  const [mode,setMode]=useState('hrd');
  const [language,setLanguage]=useState('');
  const [phase,setPhase]=useState('setup');
  const [draft,setDraft]=useState('');
  const [answers,setAnswers]=useState([]);
  const heading=useRef(null);
  useEffect(()=>{if(phase!=='setup') heading.current?.focus()},[phase]);
  const english=(language || (en?'en':'id'))==='en';
  const t=(id,eng)=>english?eng:id;
  const n=Math.min(4,phase==='feedback'?answers.length-1:answers.length);
  const bank=questions[mode];
  const q=i=>bank[i][english?1:0];
  const tip=i=>bank[i][english?3:2];
  const dims=[t('Kejelasan','Clarity'),t('Relevansi','Relevance'),t('Dampak','Impact')];
  const ratings=i=>scores[i].map((v,j)=>dims[j]+' '+v+'/5').join(' · ');
  const averages=dims.map((d,i)=>d+' '+(scores.reduce((s,row)=>s+row[i],0)/5).toLocaleString(english?'en':'id',{minimumFractionDigits:1})+'/5').join(' · ');
  const modeLabel=mode==='hrd'?'HR':t('Teknis','Technical');
  const strength=t('Contoh kekuatan: pengalaman laporan berkaitan dengan posisi magang.','Example strength: reporting experience relates to the internship.');
  const next=t('Langkah berikutnya: latih satu jawaban dengan hasil yang dapat diperiksa.','Next step: practice one answer with a result you can verify.');
  const transcript=answers.map((a,i)=>[q(i),a,ratings(i),tip(i)].join('\n')).join('\n\n');
  return <section lang={english?'en':'id'}><h2 ref={heading} tabIndex="-1">{phase==='summary'?t('Ringkasan latihan','Practice summary'):t('Latihan wawancara','Interview practice')}</h2>
    <p>{t('Gunakan jawaban fiktif. Skor dan saran contoh sudah ditentukan untuk setiap pertanyaan.','Use fictional answers. Each question has preset example scores and a tip.')}</p>
    {phase==='setup'?<><div className="controls mt-4"><label>{en?'Interview mode':'Jenis wawancara'}<select value={mode} onChange={e=>setMode(e.target.value)}><option value="hrd">HR</option><option value="user">{en?'Technical':'Teknis'}</option></select></label>
    <label>{en?'Interview language':'Bahasa wawancara'}<select value={english?'en':'id'} onChange={e=>setLanguage(e.target.value)}><option value="id">Bahasa Indonesia</option><option value="en">English</option></select></label></div>
    <Button variant="default" className="mt-4" onClick={()=>{setLanguage(english?'en':'id');setPhase('answer');onStage(2)}}>{t('Mulai latihan','Start practice')}</Button></>:
    phase==='summary'?<><p className="mt-4">{modeLabel} · {english?'EN':'ID'} · 5/5</p><p>{averages}</p><p>{strength}</p><p>{next}</p><details><summary>{t('Baca transkrip','Read transcript')}</summary><pre>{transcript}</pre></details>
    <ReportActions en={english} text={[report,t('Ringkasan latihan contoh','Sample practice summary'),modeLabel+' · '+(english?'EN':'ID')+' · 5/5',averages,strength,next,transcript].join('\n\n')}/>
    <Button className="mt-4" onClick={()=>{setPhase('setup');setAnswers([]);onStage(1)}}>{t('Latihan lagi','Practice again')}</Button></>:
    <><small className="tag mt-4">{modeLabel} · {english?'EN':'ID'} · {t('Pertanyaan','Question')} {n+1}/5</small><h3 className="question">{q(n)}</h3>
    {phase==='answer'?<form onSubmit={e=>{e.preventDefault();if(!draft.trim())return;setAnswers([...answers,redactPii(draft.trim())]);setDraft('');setPhase('feedback')}}><label htmlFor="answer">{t('Jawaban fiktif','Fictional answer')}</label><textarea id="answer" maxLength={4000} value={draft} onChange={e=>setDraft(e.target.value)}/><Button type="submit" variant="default" disabled={!draft.trim()}>{t('Lihat masukan contoh','View example feedback')}</Button></form>:
    <><p>{ratings(n)}</p><p>{tip(n)}</p><Button variant="default" className="mt-4" onClick={()=>{if(n===4){setPhase('summary');onStage(3)}else setPhase('answer')}}>{n===4?t('Lihat ringkasan','View summary'):t('Pertanyaan berikutnya','Next question')}</Button></>}</>}
  </section>;
}
