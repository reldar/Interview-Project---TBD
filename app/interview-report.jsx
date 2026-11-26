'use client';

import {
  RUBRIC,
  buildInterviewReportText,
  formatInterviewAverage,
  interviewReportLabels,
  overallInterviewAverage,
} from '../lib/interview-report';
import { ReportActions } from './report';

export function InterviewReport({ report, language, headingRef }) {
  const labels = interviewReportLabels(language);
  const { finalSummary, mode, transcript } = report;
  const { averageScores, questionsAnswered, strengths, nextSteps } = finalSummary;
  return (
    <div className="interviewReport">
      <h3 ref={headingRef} tabIndex={-1}>{labels.title}</h3>
      <p>{mode === 'hrd' ? 'HR' : labels.technical} · {labels.language} · {labels.answered} {questionsAnswered}/5</p>
      <p><strong>{labels.overall} {formatInterviewAverage(overallInterviewAverage(averageScores), language)}/5</strong></p>
      <ul>
        {RUBRIC.map((dimension) => (
          <li key={dimension.key}>
            {dimension[language]} {formatInterviewAverage(averageScores[dimension.key], language)}/5
          </li>
        ))}
      </ul>
      <h4>{labels.strengths}</h4>
      {strengths.length
        ? <ul>{strengths.map((strength) => <li key={strength}>{strength}</li>)}</ul>
        : <p>{labels.noStrengths}</p>}
      <h4>{labels.nextSteps}</h4>
      <ul>{nextSteps.map((step) => <li key={step}>{step}</li>)}</ul>
      <h4>{labels.review}</h4>
      {transcript.map(({ questionNumber, questionText, userAnswer, feedback }) => (
        <details className="interviewReviewItem" key={questionNumber}>
          <summary>{labels.question} {questionNumber}. {questionText}</summary>
          <p className="interviewReviewAnswer"><strong>{labels.answer} </strong>{userAnswer}</p>
          <p>{RUBRIC.map(({ score, ...dimension }) => `${dimension[language]} ${feedback[score]}/5`).join(' · ')}</p>
          <p><strong>{labels.tip} </strong>{feedback.suggestion}</p>
        </details>
      ))}
      <ReportActions
        text={buildInterviewReportText(report, language)}
        en={language === 'en'}
        filename={`LatihKerja-${language === 'en' ? 'interview' : 'wawancara'}-${language}.txt`}
      />
    </div>
  );
}
