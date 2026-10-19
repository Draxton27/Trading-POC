import type {ButtonHTMLAttributes,HTMLAttributes,ReactNode} from 'react';
import clsx from 'clsx';
export function Card({children,className,...props}:HTMLAttributes<HTMLDivElement>){return <div className={clsx('card',className)} {...props}>{children}</div>;}
export function Button({children,className,variant='primary',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'ghost'}){return <button className={clsx('button','button-'+variant,className)} {...props}>{children}</button>;}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'success'|'warning'|'info'}){return <span className={'badge badge-'+tone}>{children}</span>;}
export function SectionTitle({eyebrow,title,aside}:{eyebrow:string;title:string;aside?:ReactNode}){return <div className="section-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{aside}</div>;}
