"use client"; // Required for client-side fetching

import { Card, Button, Tabs, Stack, Paper, Text } from '@mantine/core';

import classes from './categories.module.css';

import {CategoriesType} from '../interface'

interface CategoriesProps {
    categories: CategoriesType;
    setSelected: (value: string) => void;
}

function Categories({categories, setSelected }: CategoriesProps) {
    return (
        <>
        {Object.entries(categories).map(([key, item]) => (
            item.available && (
            <Paper shadow='sm' className={classes['option-group']} key={key} m='sm' p='xs' ml=''>
                <Text className={classes['heading']}>{item.title}</Text>
                <Text className={classes['description']}>{item.description}</Text>
                {item.options.map((option: string, idx: number) => (
                    <Button key={idx} p='' className={classes['button']} onClick={() => setSelected(`${key}/${option}`)}>
                        {option}
                    </Button>
                ))}
            </Paper>
            ) 
        ))}
        {Object.entries(categories).map(([key, item]) => (
            !item.available && item.unavailable_options && (
            <Paper shadow='sm' className={classes['option-group']} key={key} m='sm' p='xs' ml='' bg='#F3F3F3'>
                <Text className={classes['heading']}>{item.title}</Text>
                <Text className={classes['description']}>{item.description}</Text>
                <Text className={classes['description']}>Unavailable</Text>
                {item.unavailable_options.map((option: string, idx: number) => (
                    <Button className={`${classes['button']} ${classes['button--disabled']}`} key={idx} p='' m='' disabled>
                        {option}
                    </Button>
                ))}
            </Paper>
            ) 
        ))}
        </>
    );
}

export default Categories;
