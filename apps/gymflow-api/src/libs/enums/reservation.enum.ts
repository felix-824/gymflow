import { registerEnumType } from '@nestjs/graphql';

export enum ReservationStatus {
	PENDING = 'PENDING',
	CONFIRMED = 'CONFIRMED',
	CANCELLED = 'CANCELLED',
	COMPLETED = 'COMPLETED',
	NO_SHOW = 'NO_SHOW',
}
registerEnumType(ReservationStatus, {
	name: 'ReservationStatus',
});

export const RESERVATION_TIMEZONE = 'Asia/Seoul';
export const RESERVATION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const RESERVATION_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
