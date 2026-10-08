import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Like, MeLiked } from '../../libs/dto/like/like';
import { LikeInput } from '../../libs/dto/like/like.input';
import { T } from '../../libs/types/common';
import { Message } from '../../libs/enums/common.enum';
import { LikeGroup } from '../../libs/enums/like.enum';
import { OrdinaryInquiry } from '../../libs/dto/property/property.input';
import { Properties } from '../../libs/dto/property/property';
import { lookup } from 'dns';
import { lookupFavorite } from '../../libs/config';

@Injectable()
export class LikeService {
    constructor(@InjectModel('Like') private readonly likeModel: Model<Like>) {}

   // Like mavjud bo'lsa o'chiradi (-1),
   //  mavjud bo'lmasa yangi like yaratadi (+1)
   public async toggleLike(input: LikeInput): Promise<number> {
	const search: T = {
		memberId: input.memberId,
		likeRefId: input.likeRefId,
	};
  
	const exist = await this.likeModel.findOne(search).exec();

	let modifier = 1;

	if (exist) {
		await this.likeModel.findOneAndDelete(search).exec();
		modifier = -1;
	} else {
		try {
			await this.likeModel.create(input);
		} catch (err) {
			if (err instanceof Error) {
				console.log('Error, Service.model:', err.message);
			}

			throw new BadRequestException(Message.CREATE_FAILED);
		}
	}

	console.log(`- Like modifier ${modifier} -`);

	return modifier;
}

public async checkLikeExistence(input: LikeInput): Promise<MeLiked[]> {
    const { memberId, likeRefId } = input;
    const result = await this.likeModel.findOne({ memberId: memberId, likeRefId }).exec();
    return result ? [{ memberId: memberId, likeRefId: likeRefId, myFavorite: true}] : [];
}

// Member like bosgan propertylarni likes orqali topib,
//  property ma'lumotlari bilan birlashtiradi.
public async getFavoriteProperties(memberId: ObjectId, input: OrdinaryInquiry): Promise<Properties> {
	const { page, limit } = input;
	const match: T = { likeGroup: LikeGroup.PROPERTY, memberId: memberId };

	const data: T = await this.likeModel
		.aggregate([
			{ $match: match },
			{ $sort: { updatedAt: -1 } },
			{
				$lookup: {
					from: 'properties',
					localField: 'likeRefId',
					foreignField: '_id',
					as: 'favoriteProperty',
				},
			},
			{ $unwind: '$favoriteProperty' },
			{
				$facet: {
					list: [
						{ $skip: (page - 1) * limit },
						{ $limit: limit },
						 lookupFavorite,
						 { $unwind: '$favoriteProperty.memberData' },
						],
						   metaCounter: [{ $count: 'total'}],
				   },

			   },
		])
		.exec();

	console.log("data:");
	const result: Properties = { list: [], metaCounter: data[0].metaCounter};
	result.list = data[0].list.map((ele) => ele.favoriteProperty);
	return result;
}


}
