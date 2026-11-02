import {prepareOfflineAttendance} from './event-attendance.js';
import {identifier} from './validation.js';
import {permit,permitLabel,permitSource} from './auth.js';
import {requireThat} from './errors.js';

export const ATTENDANCE_SOURCE='manual-attendance';
const columns=`id,content_hash AS "contentHash",label_id AS "labelId",event_id AS "eventId",
session_id AS "sessionId",source_receipt_id AS "sourceReceiptId",occurred_at AS "occurredAt",
attendee_count::text AS "attendeeCount",received_at AS "receivedAt"`;
function reportRow(row) {
  return {...row,occurredAt:new Date(row.occurredAt).toISOString(),receivedAt:new Date(row.receivedAt).toISOString(),
    provenance:'manual_attested',providerVerified:false,isLive:false};
}

/** Aggregate reports are immutable deltas. No tickets, QR payloads or customer identities are stored. */
export function attendanceStore(pool,transaction) {
  return {
    async recordAttendance(raw,principal,asOf=new Date().toISOString()) {
      permit(principal,'ingest');permitLabel(principal,raw?.labelId);permitSource(principal,ATTENDANCE_SOURCE);
      const report=prepareOfflineAttendance(raw,{labelId:raw.labelId,asOf});
      return transaction(async client=>{
        const inserted=await client.query(`INSERT INTO music_attendance_reports
(id,content_hash,label_id,event_id,session_id,source_receipt_id,occurred_at,attendee_count)
VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING ${columns}`,
          [report.id,report.contentHash,report.labelId,report.eventId,report.sessionId,report.sourceReceiptId,report.occurredAt,report.attendeeCount]);
        if (!inserted.rows.length) {
          const existing=(await client.query(`SELECT ${columns} FROM music_attendance_reports WHERE id=$1 AND label_id=$2`,[report.id,report.labelId])).rows[0];
          requireThat(existing?.contentHash===report.contentHash,'Attendance receipt was reused with different content',409);
          return {report:reportRow(existing),duplicate:true};
        }
        await client.query(`INSERT INTO music_audit(actor,action,label_ids,details) VALUES($1,'attendance.recorded',$2,$3)`,
          [principal.id,[report.labelId],JSON.stringify({reportId:report.id,provenance:'manual_attested'})]);
        return {report:reportRow(inserted.rows[0]),duplicate:false};
      });
    },
    async attendanceReports({labelId,eventId,sessionId,limit=100},principal) {
      permit(principal,'read');permitLabel(principal,labelId);permitSource(principal,ATTENDANCE_SOURCE);
      identifier(labelId,'labelId');
      if(eventId!==undefined) identifier(eventId,'eventId');
      if(sessionId!==undefined) identifier(sessionId,'sessionId');
      requireThat(Number.isSafeInteger(limit)&&limit>0&&limit<=1000,'limit must be 1–1000',400);
      const rows=(await pool.query(`SELECT ${columns} FROM music_attendance_reports WHERE label_id=$1
AND ($2::text IS NULL OR event_id=$2) AND ($3::text IS NULL OR session_id=$3)
ORDER BY occurred_at DESC,id LIMIT $4`,[labelId,eventId??null,sessionId??null,limit])).rows;
      return rows.map(reportRow);
    }
  };
}
