import React from 'react';
import { SiteLayout } from '../components/SiteLayout.jsx';
import styles from './board.css?raw';

// The board is readable immediately; only its live data and dialog need browser JS.
export function BoardPage({ script }) {
  return <SiteLayout title="Overflow" description="A little help from your friends." path="/" styles={styles} script={script}>
    <main className="board-page" aria-label="Overflow board">
      <section className="people" aria-labelledby="credits-title">
        <h2 id="credits-title">Credits</h2>
        <ul className="members" id="members" aria-busy="true" />
        <p className="empty" id="people-empty" hidden>No one here yet.</p>
      </section>
      <section className="work" aria-labelledby="work-title">
        <h2 id="work-title">Tasks</h2>
        <ul className="jobs" id="jobs" aria-busy="true" />
        <p className="empty" id="jobs-empty" hidden>No tasks yet.</p>
      </section>
      <p className="error" id="error" role="status" hidden />
    </main>
    <dialog className="dialog" id="task-dialog" aria-labelledby="dialog-title">
      <div className="dialog-shell">
        <div className="dialog-head">
          <p className="dialog-kicker">Task details</p>
          <button className="dialog-close" id="dialog-close" type="button" aria-label="Close task details">×</button>
        </div>
        <div className="dialog-body" id="dialog-body" />
      </div>
    </dialog>
  </SiteLayout>;
}
