import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import ReviewSchema from '../../schemas/Review.model';
import ReservationSchema from '../../schemas/Reservation.model';
import MemberSchema from '../../schemas/Member.model';
import ProgramSchema from '../../schemas/Program.model';
import { AuthModule } from '../auth/auth.module';
import { ReviewResolver } from './review.resolver';
import { ReviewService } from './review.service';

@Module({
	imports: [
		AuthModule,
		MongooseModule.forFeature([
			{ name: 'Review', schema: ReviewSchema },
			{ name: 'Reservation', schema: ReservationSchema },
			{ name: 'Member', schema: MemberSchema },
			{ name: 'Program', schema: ProgramSchema },
		]),
	],
	providers: [ReviewResolver, ReviewService],
})
export class ReviewModule {}
