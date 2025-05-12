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
            <Paper shadow='sm' className={classes.option_list} key={key} m='sm' p='xs' ml=''>
                <Text size='lg' c="black">{item.title}</Text>
                <Text size='sm' c="gray">{item.description}</Text>
                {item.options.map((option: string, idx: number) => (
                    <Button key={idx} p='' variant='outline' classNames={classes} onClick={() => setSelected(`${key}/${option}`)} style={{display: 'inline flow-root'}}>
                        {option}
                    </Button>
                ))}
            </Paper>
            ) 
        ))}
        {Object.entries(categories).map(([key, item]) => (
            !item.available && item.unavailable_options && (
            <Paper shadow='sm' className={classes.option_list} key={key} m='sm' p='xs' ml='' bg='#F3F3F3'>
                <Text size='lg' c="gray">{item.title}</Text>
                <Text size='sm' c="gray">{item.description}</Text>
                <Text size='sm' c="gray">Unavailable</Text>
                {item.unavailable_options.map((option: string, idx: number) => (
                    <Button classNames={classes} key={idx} p='' m='' disabled style={{display: 'inline flow-root'}}>
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
