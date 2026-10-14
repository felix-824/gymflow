import { Schema } from 'mongoose';
import { ReservationStatus, RESERVATION_DATE_PATTERN, RESERVATION_TIME_PATTERN } from '../libs/enums/reservation.enum';
import { assertReservation } from '../libs/reservation.validation';

const ReservationSchema = new Schema(
	{
		reservationDate: { type: String, required: true, minlength: 10, maxlength: 10, match: RESERVATION_DATE_PATTERN },
		startTime: { type: String, required: true, minlength: 5, maxlength: 5, match: RESERVATION_TIME_PATTERN },
		endTime: { type: String, required: true, minlength: 5, maxlength: 5, match: RESERVATION_TIME_PATTERN },
		reservationStatus: { type: String, enum: ReservationStatus, default: ReservationStatus.PENDING, required: true },
		specialRequest: { type: String },
		memberId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		trainerId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		programId: { type: Schema.Types.ObjectId, required: true, ref: 'Program' },
	},
	{ timestamps: true, collection: 'reservations' },
);
ReservationSchema.pre('validate', function () {
	assertReservation(this.toObject());
});
ReservationSchema.index({ memberId: 1, reservationDate: 1 });
ReservationSchema.index({ trainerId: 1, reservationDate: 1 });
ReservationSchema.index({ programId: 1, reservationDate: 1, startTime: 1 });
export default ReservationSchema;
