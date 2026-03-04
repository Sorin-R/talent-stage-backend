import { RowDataPacket } from 'mysql2';
import pool from './database';

export const isFeatureFlagEnabled = async (
  flagKey: string,
  fallback: boolean
): Promise<boolean> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT flag_value FROM feature_flags WHERE flag_key = ? LIMIT 1',
      [flagKey]
    );
    const row = rows[0];
    if (!row || row.flag_value === undefined || row.flag_value === null) return fallback;
    return Number(row.flag_value) === 1;
  } catch {
    return fallback;
  }
};
