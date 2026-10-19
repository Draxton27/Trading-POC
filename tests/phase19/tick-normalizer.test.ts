import {describe,it,expect} from 'vitest';
import {TickBook,normalizeFeed} from '../../apps/ibkr-agent/src/connection/tick-normalizer.ts';

describe('ticks TWS por solicitud',()=>{
  it('clasifica los cinco estados y reinicia al cambiar la calidad',()=>{
    expect([1,2,3,4,99].map(normalizeFeed)).toEqual(
      ['LIVE','FROZEN','DELAYED','DELAYED_FROZEN','UNKNOWN']);
    const book=new TickBook();book.setFeed(1);book.price(1,100);book.price(2,101);
    book.setFeed(3);expect(book.snapshot().bid).toBeNull();expect(book.snapshot().ask).toBeNull();
    expect(book.price(1,102)).toBe(false);
    book.price(66,98);book.price(67,99);
    expect(book.snapshot()).toMatchObject({bid:98,ask:99,feedType:'DELAYED'});
    book.setFeed(4);expect(book.snapshot().bid).toBeNull();
  });
  it('normaliza precios, tamaños y griegas live/frozen y delayed',()=>{
    for(const [feed,price,size,greek] of [[1,1,0,13],[2,1,0,13],[3,66,69,83],[4,66,69,83]]){
      const book=new TickBook();book.setFeed(feed);
      book.price(price,200);book.price(feed<=2?2:67,201);
      book.price(feed<=2?4:68,200.5);
      book.size(size,11);book.size(feed<=2?3:70,12);
      book.greeks(greek,.32,.4,.02,.15,-.08);
      expect(book.snapshot()).toMatchObject({bid:200,ask:201,last:200.5,
        bidSize:11,askSize:12,delta:.4,gamma:.02,vega:.15,
        theta:-.08,impliedVolatility:.32});
      expect(book.snapshot().feedType).toBe(normalizeFeed(feed));
    }
  });
  it('rechaza valores no válidos y nunca combina bid live con ask delayed',()=>{
    const book=new TickBook();book.setFeed(3);
    expect(book.price(1,100)).toBe(false);
    book.price(66,-1);book.price(67,0);
    book.size(69,-5);book.greeks(83,-1,2,-1,-1,Number.NaN);
    expect(book.snapshot()).toMatchObject({bid:null,ask:null,bidSize:null,
      delta:null,gamma:null,vega:null,theta:null,impliedVolatility:null});
    expect(book.price(67,101)).toBe(true);
    expect(book.snapshot().bid).toBeNull();
  });
});
