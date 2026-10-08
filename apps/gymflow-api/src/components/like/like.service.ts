import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
type ObjectId = Types.ObjectId;
import { Like, MeLiked } from '../../libs/dto/like/like';
import { LikeInput } from '../../libs/dto/like/like.input';
import { LikeGroup } from '../../libs/enums/like.enum';
import { OrdinaryInquiry } from '../../libs/dto/common/inquiry';
import { Programs } from '../../libs/dto/program/program';
import { isDuplicateKey } from '../../libs/types/database-error';
import { savedProgramStages } from '../../libs/program.aggregation';

@Injectable()
export class LikeService {
	constructor(@InjectModel('Like') private readonly likeModel: Model<Like>) {}

	async toggleLike(input: LikeInput): Promise<number> {
		const search = { memberId: input.memberId, likeRefId: input.likeRefId, likeGroup: input.likeGroup };
		const removed = await this.likeModel.findOneAndDelete(search).exec();
		if (removed) return -1;
		try {
			await this.likeModel.create(input);
			return 1;
		} catch (error) {
			if (isDuplicateKey(error)) return 0;
			throw error;
		}
	}
	async checkLikeExistence(input: LikeInput): Promise<MeLiked[]> {
		const { memberId, likeRefId, likeGroup } = input;
		const found = await this.likeModel.exists({ memberId, likeRefId, likeGroup }).exec();
		return found ? [{ memberId, likeRefId, myFavorite: true }] : [];
	}
	async getFavoritePrograms(memberId: ObjectId, input: OrdinaryInquiry): Promise<Programs> {
		const [result] = await this.likeModel
			.aggregate<Programs>(savedProgramStages('like', memberId, input.page, input.limit))
			.exec();
		const programs = result ?? { list: [], metaCounter: [] };
		for (const program of programs.list) program.meLiked = [{ memberId, likeRefId: program._id, myFavorite: true }];
		return programs;
	}
	async removeProgramLikes(programId: ObjectId): Promise<void> {
		await this.likeModel.deleteMany({ likeGroup: LikeGroup.PROGRAM, likeRefId: programId }).exec();
	}
}
