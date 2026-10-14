import { Field, ObjectType } from '@nestjs/graphql';
import { Types } from 'mongoose';
type ObjectId = Types.ObjectId;
import { ReservationStatus, RESERVATION_TIMEZONE } from '../../enums/reservation.enum';

@ObjectType({ description: 'Reservation date and times in ' + RESERVATION_TIMEZONE })
export class Reservation {
	@Field(() => String) _id: ObjectId;
	@Field(() => String) reservationDate: string;
	@Field(() => String) startTime: string;
	@Field(() => String) endTime: string;
	@Field(() => ReservationStatus) reservationStatus: ReservationStatus;
	@Field(() => String, { nullable: true }) specialRequest?: string | null;
	@Field(() => String) memberId: ObjectId;
	@Field(() => String) trainerId: ObjectId;
	@Field(() => String) programId: ObjectId;
	@Field(() => Date) createdAt: Date;
	@Field(() => Date) updatedAt: Date;
}
